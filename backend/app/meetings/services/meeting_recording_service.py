"""Room-wide LiveKit Egress recording to private S3-compatible storage."""

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

import boto3
from aiohttp import ClientError
from botocore.config import Config
from livekit import api

from app.core.config import settings
from app.meetings.services import meeting_capture_store as store
from app.meetings.services.livekit_service import parse_study_room_livekit_name, study_room_livekit_name

logger = logging.getLogger(__name__)
_START_GRACE = timedelta(minutes=2)
_STATES = {
    api.EgressStatus.EGRESS_STARTING: "starting",
    api.EgressStatus.EGRESS_ACTIVE: "active",
    api.EgressStatus.EGRESS_ENDING: "ending",
    api.EgressStatus.EGRESS_COMPLETE: "complete",
    api.EgressStatus.EGRESS_FAILED: "failed",
    api.EgressStatus.EGRESS_ABORTED: "failed",
    api.EgressStatus.EGRESS_LIMIT_REACHED: "failed",
}


class RecordingConflict(Exception):
    pass


def _livekit_api() -> api.LiveKitAPI:
    return api.LiveKitAPI(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)


def object_key(recording_id: uuid.UUID) -> str:
    return f"meeting-recordings/{recording_id}.mp4"


def _start_request(room_id: uuid.UUID, recording_id: uuid.UUID) -> api.RoomCompositeEgressRequest:
    return api.RoomCompositeEgressRequest(
        room_name=study_room_livekit_name(room_id),
        layout="speaker",
        preset=api.EncodingOptionsPreset.H264_720P_30,
        file_outputs=[api.EncodedFileOutput(
            file_type=api.EncodedFileType.MP4,
            filepath=object_key(recording_id),
            disable_manifest=True,
            s3=api.S3Upload(
                bucket=settings.meeting_recording_s3_bucket,
                region=settings.meeting_recording_s3_region,
                endpoint=settings.meeting_recording_s3_endpoint or "",
                access_key=settings.meeting_recording_s3_access_key,
                secret=settings.meeting_recording_s3_secret_key,
                session_token=settings.meeting_recording_s3_session_token or "",
                force_path_style=bool(settings.meeting_recording_s3_endpoint),
                content_disposition=f'attachment; filename="cuoc-hop-{recording_id}.mp4"',
            ),
        )],
    )


def _request_key(info: api.EgressInfo) -> str:
    if info.room_composite.file_outputs:
        return info.room_composite.file_outputs[0].filepath
    if info.file_results:
        return info.file_results[0].filename
    return ""


async def accept_egress_update(info: api.EgressInfo, recording_id: uuid.UUID | None = None) -> None:
    room_id = parse_study_room_livekit_name(info.room_name)
    if room_id is None:
        return
    if recording_id is None and info.egress_id:
        recording_id = await store.recording_id_for_egress(room_id, info.egress_id)
    if recording_id is None:
        key = _request_key(info)
        try:
            recording_id = uuid.UUID(key.rsplit("/", 1)[-1].removesuffix(".mp4"))
        except ValueError:
            return
        if key != object_key(recording_id):
            return

    recording = await store.get_recording(room_id, recording_id)
    if recording is None or (info.room_id and info.room_id != recording["livekit_sid"]):
        return
    new_state = _STATES.get(info.status)
    if new_state == "complete" and (
        info.backup_storage_used or not any(file.size > 0 for file in info.file_results)
    ):
        new_state = "failed"
    if new_state is not None:
        await store.update_recording(recording_id, new_state, info.egress_id or None)


async def refresh_recordings(room_id: uuid.UUID, recordings) -> None:
    pending = [row for row in recordings if row["status"] in store.ACTIVE_RECORDING_STATES]
    if not pending:
        return
    try:
        async with _livekit_api() as client:
            async with asyncio.timeout(6):
                known = [row for row in pending if row["egress_id"]]
                unknown = [row for row in pending if not row["egress_id"]]
                lookups = [
                    client.egress.list_egress(api.ListEgressRequest(egress_id=row["egress_id"]))
                    for row in known
                ]
                if unknown:
                    lookups.append(client.egress.list_egress(
                        api.ListEgressRequest(room_name=study_room_livekit_name(room_id))
                    ))
                results = await asyncio.gather(*lookups)

        for row, result in zip(known, results):
            for info in result.items:
                await accept_egress_update(info, row["id"])

        if unknown:
            by_path = {_request_key(info): info for info in results[-1].items}
            for row in unknown:
                info = by_path.get(object_key(row["id"]))
                if info is not None:
                    await accept_egress_update(info, row["id"])
                elif datetime.now(timezone.utc) - row["started_at"] > _START_GRACE:
                    await store.update_recording(row["id"], "failed")
    except (api.ServerError, ClientError, OSError, TimeoutError) as error:
        logger.warning("Could not check meeting recording status (%s)", type(error).__name__)


async def start_recording(room_id: uuid.UUID, capture_id: uuid.UUID, livekit_sid: str):
    recording_id = uuid.uuid4()
    if not await store.reserve_recording(capture_id, recording_id):
        raise RecordingConflict("Phòng đang có bản ghi được xử lý.")
    try:
        async with _livekit_api() as client:
            # A timed-out start may have succeeded remotely. The reservation is
            # reconciled by the signed webhook or the next list request.
            info = await asyncio.wait_for(
                client.egress.start_room_composite_egress(_start_request(room_id, recording_id)), timeout=30,
            )
            if info.room_id and info.room_id != livekit_sid:
                await client.egress.stop_egress(api.StopEgressRequest(egress_id=info.egress_id))
                await store.update_recording(recording_id, "failed")
                raise RecordingConflict("Cuộc gọi đã đổi. Hãy mở lại mục bản ghi.")
    except api.ServerError as error:
        if error.status < 500:
            await store.update_recording(recording_id, "failed")
        raise
    await accept_egress_update(info, recording_id)
    return await store.get_recording(room_id, recording_id)


async def stop_recording(room_id: uuid.UUID, recording):
    if recording["status"] in ("ending", "complete", "failed"):
        return recording
    if not recording["egress_id"]:
        raise RecordingConflict("Đang chuẩn bị ghi hình. Hãy thử lại sau vài giây.")
    async with _livekit_api() as client:
        info = await asyncio.wait_for(
            client.egress.stop_egress(api.StopEgressRequest(egress_id=recording["egress_id"])), timeout=10,
        )
    await accept_egress_update(info, recording["id"])
    return await store.get_recording(room_id, recording["id"])


def recording_download_url(recording_id: uuid.UUID) -> str:
    with boto3.client(
        "s3",
        region_name=settings.meeting_recording_s3_region,
        endpoint_url=settings.meeting_recording_s3_endpoint,
        aws_access_key_id=settings.meeting_recording_s3_access_key,
        aws_secret_access_key=settings.meeting_recording_s3_secret_key,
        aws_session_token=settings.meeting_recording_s3_session_token,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if settings.meeting_recording_s3_endpoint else "auto"},
        ),
    ) as client:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.meeting_recording_s3_bucket, "Key": object_key(recording_id)},
            ExpiresIn=300,
        )
