from typing import TypeVar

import anthropic
from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.core.config import settings
from app.roadmaps.dto.roadmap_dto import RoadmapAnswer, RoadmapSuggestion, RoadmapSuggestQuestionsResponse, TaskSuggestionResponse
from app.group_tasks.dto.group_task_dto import AIGroupTaskSuggestion

T = TypeVar("T", bound=BaseModel)

_ROADMAP_SYSTEM_PROMPT = (
    "You design personal learning roadmaps for a study-together app. Given the "
    "learner's goal (and any answers they gave to clarifying questions), respond with "
    "a concise title, a one-sentence goal restatement, and 4 to 8 sequential phases "
    "ordered from beginner to advanced. Write every field in Vietnamese, matching the "
    "language the learner used. "
    "CRITICAL: If the learner's goal is completely nonsensical, gibberish, or too vague to understand (e.g. 'abc', 'test', '123'), you MUST return an empty list for 'phases' and empty strings for title and goal."
)

_QUESTIONS_SYSTEM_PROMPT = (
    "You help personalize a learning roadmap for a study-together app. Given the "
    "learner's goal, ask 3 to 4 short multiple-choice questions whose answers would "
    "change how the roadmap should be structured -- e.g. current skill level, hours "
    "available per week, how firm the deadline is, preferred learning style. Each "
    "question needs 2 to 4 concise answer options. Write every field in Vietnamese, "
    "matching the language the learner used. "
    "CRITICAL: If the learner's goal is completely nonsensical, gibberish, or too vague to understand (e.g. 'abc', 'test', '123'), you MUST return an empty list for 'questions'."
)

_TASK_SUGGESTION_SYSTEM_PROMPT = (
    "You are an elite study coach and career mentor. You have encyclopedic knowledge of how the world's top learners "
    "actually structure their studies, drawn from: Reddit communities (r/learnprogramming, r/languagelearning, r/medicalschool, "
    "r/cscareerquestions, r/JLPT, r/datascience), roadmap.sh, Coursera/edX/Udemy course syllabi, "
    "MIT OpenCourseWare, freeCodeCamp, LeetCode study plans, ANKI decks, and industry hiring rubrics. "
    "Given a learner's goal, roadmap phases, start date, and optional deadline, generate a COMPREHENSIVE, "
    "session-level task list that covers the ENTIRE learning journey from day 1 to deadline. \n\n"
    "STRICT RULES:\n"
    "1. QUANTITY: Generate EXACTLY 30 to 50 tasks. You MUST NOT stop at 20. Cover every phase thoroughly.\n"
    "2. SPECIFICITY: Every task must name the specific resource, platform, chapter, or deliverable. "
    "FORBIDDEN: 'Study grammar'. REQUIRED: 'Hoàn thành chương 3 JLPT Sensei - Mẫu ngữ pháp N2 ~te iru/aru (90 phút)'. \n"
    "3. SESSION-LEVEL: Each task = one focused study session (1-3 hours). Break big topics into multiple sessions.\n"
    "4. REAL RESOURCES: Reference actual platforms and materials, e.g.: Anki, Wanikani, JLPT Sensei, LeetCode, "
    "freeCodeCamp, Scrimba, The Odin Project, Khan Academy, Coursera (specific course names), "
    "YouTube channels (Traversy Media, Fireship, etc.), specific textbooks.\n"
    "5. TIMELINE: Spread tasks realistically across ALL days from today to deadline. Front-load foundations, "
    "back-load practice/review. Include spaced repetition review sessions.\n"
    "6. PRIORITY: 3 (high) = core concepts and mandatory milestones, 2 (medium) = practice & exercises, "
    "1 (low) = supplementary reading, optional deep-dives, enrichment content.\n"
    "7. PHASE COVERAGE: For EACH phase in the roadmap, generate at least 4-6 specific tasks.\n"
    "8. due_date: MUST be a real ISO date (YYYY-MM-DD) calculated from 'today'. NEVER use relative terms.\n"
    "9. LANGUAGE: Write all task titles in Vietnamese. Keep under 100 chars per title.\n"
    "10. VALIDATION: If goal is nonsensical or gibberish, return empty tasks list."
)

# Plain JSON Schemas (not RoadmapSuggestion.model_json_schema()) -- Gemini's schema
# transformer does not reliably resolve the $defs/$ref pairs Pydantic emits for a model
# with nested models like RoadmapPhaseSuggestion/RoadmapQuestion. Kept as dicts so they
# never depend on that transformer; the response is validated against the matching
# Pydantic model after the call instead.
_GEMINI_ROADMAP_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "goal": {"type": "string"},
        "phases": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            },
        },
    },
    "required": ["title", "goal", "phases"],
}

_GEMINI_QUESTIONS_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"label": {"type": "string"}},
                            "required": ["label"],
                        },
                    },
                },
                "required": ["question", "options"],
            },
        },
    },
    "required": ["questions"],
}

_GEMINI_TASK_SCHEMA = {
    "type": "object",
    "properties": {
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "due_date": {"type": "string"},
                    "priority": {"type": "integer"},
                },
                "required": ["title", "due_date", "priority"],
            },
        },
    },
    "required": ["tasks"],
}

_GEMINI_GROUP_TASK_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "assignee": {"type": "string"},
                    "due_date": {"type": "string"},
                    "notes": {"type": "array", "items": {"type": "string"}},
                    "children": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "assignee": {"type": "string"},
                                "due_date": {"type": "string"},
                                "notes": {"type": "array", "items": {"type": "string"}},
                                "children": {"type": "array", "items": {"type": "object"}},
                            },
                            "required": ["title", "assignee", "due_date", "notes", "children"],
                        },
                    },
                },
                "required": ["title", "assignee", "due_date", "notes", "children"],
            },
        },
    },
    "required": ["title", "nodes"],
}

_GROUP_TASK_SYSTEM_PROMPT = (
    "Bạn là huấn luyện viên học tập giàu kinh nghiệm. Từ mục tiêu của người dùng, "
    "tạo một lộ trình nhiệm vụ dạng cây để cả nhóm có thể theo sát. Hãy suy luận dựa "
    "trên kiến thức thực tế, giáo trình/cộng đồng uy tín và thời gian khả dụng. "
    "Viết toàn bộ nội dung bằng tiếng Việt. Tạo 2-5 nhánh gốc, mỗi nhánh có 3-8 nhiệm vụ con "
    "hoặc nhiệm vụ con sâu hơn một cấp khi cần. Phải đưa ra thứ tự hợp lý, hạn ngày YYYY-MM-DD "
    "phân bổ đều từ hôm nay tới deadline, và ghi rõ nguồn tài liệu/công việc cụ thể trong notes. "
    "Ưu tiên mục tiêu đạt mục tiêu; không nhồi nhét hơn thời gian người dùng. "
    "Nếu mục tiêu mơ hồ hoặc vô nghĩa, trả title rỗng và nodes rỗng."
)


def _build_roadmap_prompt(description: str, answers: list[RoadmapAnswer]) -> str:
    if not answers:
        return description
    qa = "\n".join(f"- {answer.question} {answer.answer}" for answer in answers)
    return f"{description}\n\nCâu trả lời của người học cho các câu hỏi làm rõ:\n{qa}"


class RoadmapAiServiceNotConfigured(Exception):
    """Raised when settings.ai_provider names a provider whose API key is unset, or an
    unknown provider -- see Settings.ai_provider."""


class RoadmapAiError(Exception):
    """Raised when the configured AI provider is unreachable or returns an unusable response."""


class RoadmapAiService:
    async def suggest_questions(self, description: str) -> RoadmapSuggestQuestionsResponse:
        return await self._generate(
            content=description,
            system=_QUESTIONS_SYSTEM_PROMPT,
            output_model=RoadmapSuggestQuestionsResponse,
            gemini_schema=_GEMINI_QUESTIONS_SCHEMA,
        )

    async def suggest(self, description: str, answers: list[RoadmapAnswer]) -> RoadmapSuggestion:
        return await self._generate(
            content=_build_roadmap_prompt(description, answers),
            system=_ROADMAP_SYSTEM_PROMPT,
            output_model=RoadmapSuggestion,
            gemini_schema=_GEMINI_ROADMAP_SCHEMA,
        )

    async def suggest_tasks(self, goal: str, phases: list[str], today: str, due_date: str | None) -> TaskSuggestionResponse:
        phases_text = '\n'.join(f'  Phase {i+1}: {p}' for i, p in enumerate(phases)) if phases else '(no phases provided)'
        deadline_text = f'Deadline: {due_date}' if due_date else 'No specific deadline (plan for 8 weeks from today)'
        num_phases = len(phases) if phases else 1
        target_tasks = max(30, num_phases * 6)  # at least 6 tasks per phase
        content = (
            f"=== TASK GENERATION REQUEST ===\n"
            f"{deadline_text}\n"
            f"Target: Generate {target_tasks} to {target_tasks + 10} tasks minimum\n\n"
            f"Learner's goal: {goal}\n\n"
            f"Roadmap phases ({num_phases} phases):\n{phases_text}\n\n"
            f"IMPORTANT INSTRUCTIONS:\n"
            f"- You MUST generate at least {target_tasks} tasks. Do NOT stop early.\n"
            f"- For EACH of the {num_phases} phases above, create at least 5-6 concrete, session-level tasks.\n"
            f"- Name specific books, platforms, courses, or tools in each task title.\n"
            f"- Include review/spaced-repetition sessions between phases.\n"
            f"- Spread tasks evenly across the timeline from {today} to the deadline."
        )
        return await self._generate(
            content=content,
            system=_TASK_SUGGESTION_SYSTEM_PROMPT,
            output_model=TaskSuggestionResponse,
            gemini_schema=_GEMINI_TASK_SCHEMA,
        )

    async def suggest_group_tasks(
        self,
        goal: str,
        due_date: str | None,
        hours_per_week: int,
        current_level: str,
        today: str,
    ) -> AIGroupTaskSuggestion:
        deadline = due_date or "8 tuần từ hôm nay"
        content = (
            f"Mục tiêu: {goal}\n"
            f"Deadline: {deadline}\n"
            f"Trình độ hiện tại: {current_level}\n"
            f"Thời gian có thể học: {hours_per_week} giờ/tuần\n"
            f"Hôm nay: {today}\n"
            f"Mọi due_date phải nằm trong khoảng {today} đến {deadline}; nhiệm vụ con không được trễ hơn nhánh cha.\n"
            "Tối thiểu 12 nhiệm vụ cụ thể, tối đa 80 nhiệm vụ. "
            "Mỗi node title ngắn gọn; assignee mặc định Cả nhóm."
        )
        return await self._generate(
            content=content,
            system=_GROUP_TASK_SYSTEM_PROMPT,
            output_model=AIGroupTaskSuggestion,
            gemini_schema=_GEMINI_GROUP_TASK_SCHEMA,
        )

    async def _generate(self, *, content: str, system: str, output_model: type[T], gemini_schema: dict) -> T:
        if settings.ai_provider == "gemini":
            return await self._generate_with_gemini(content, system, output_model, gemini_schema)
        if settings.ai_provider == "anthropic":
            return await self._generate_with_anthropic(content, system, output_model)
        raise RoadmapAiServiceNotConfigured(f"Unknown AI_PROVIDER: {settings.ai_provider!r}")

    async def _generate_with_anthropic(self, content: str, system: str, output_model: type[T]) -> T:
        if not settings.anthropic_api_key:
            raise RoadmapAiServiceNotConfigured("ANTHROPIC_API_KEY is not configured")

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        try:
            response = await client.messages.parse(
                model="claude-opus-5",
                # A group task tree (up to 80 nodes with notes, in Vietnamese) does not fit in 4096.
                max_tokens=16000,
                system=system,
                messages=[{"role": "user", "content": content}],
                output_format=output_model,
            )
        except anthropic.APIError as exc:
            raise RoadmapAiError(f"Anthropic request failed: {exc}") from exc
        except ValidationError as exc:
            raise RoadmapAiError(f"Anthropic returned output that does not match the schema: {exc}") from exc

        if response.parsed_output is None:
            raise RoadmapAiError(f"Anthropic returned no parsable output (stop_reason={response.stop_reason})")
        return response.parsed_output

    async def _generate_with_gemini(self, content: str, system: str, output_model: type[T], gemini_schema: dict) -> T:
        if not settings.gemini_api_key:
            raise RoadmapAiServiceNotConfigured("GEMINI_API_KEY is not configured")

        client = genai.Client(api_key=settings.gemini_api_key)
        try:
            response = await client.aio.models.generate_content(
                model="gemini-3.6-flash",
                contents=content,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    response_mime_type="application/json",
                    response_schema=gemini_schema,
                ),
            )
        except genai.errors.APIError as exc:
            raise RoadmapAiError(f"Gemini request failed: {exc}") from exc

        try:
            return output_model.model_validate_json(response.text or "")
        except ValidationError as exc:
            raise RoadmapAiError(f"Gemini returned output that does not match the schema: {exc}") from exc
