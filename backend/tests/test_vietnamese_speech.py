from app.meetings.services.vietnamese_speech_service import SpeechSegments


def test_live_caption_uses_one_id_when_the_provider_revises_the_draft():
    captions = []
    segments = SpeechSegments(lambda *line: captions.append(line))

    segments.consume([{"text": "Thảo luận về giải", "is_final": False}])
    segments.consume([
        {"text": "Thảo luận về", "is_final": True},
        {"text": " giảng", "is_final": False},
    ])
    segments.consume([
        {"text": " gia\u0309i tích.", "is_final": True},
        {"text": "<end>", "is_final": True},
    ])

    caption_id = captions[0][0]
    assert captions == [
        (caption_id, "Thảo luận về giải", False),
        (caption_id, "Thảo luận về giảng", False),
        (caption_id, "Thảo luận về giải tích.", True),
    ]


def test_tentative_words_do_not_become_final_on_disconnect():
    captions = []
    segments = SpeechSegments(lambda *line: captions.append(line))
    segments.consume([
        {"text": "Giảng viên dặn", "is_final": True},
        {"text": " nghỉ học", "is_final": False},
    ])
    segments.finish()

    assert captions[-1] == (captions[0][0], "Giảng viên dặn", True)
