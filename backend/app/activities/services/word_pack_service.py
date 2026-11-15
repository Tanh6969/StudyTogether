"""Generates the "Ôn bài" word pack for the Phấn Trắng game from the group's study topic.

Reuses RoadmapAiService's provider plumbing (Anthropic or Gemini, chosen by AI_PROVIDER) so
the two features share one configuration. Returns drawable Vietnamese nouns with a 1-3
difficulty; the host previews and prunes the list before the game starts.
"""

from pydantic import BaseModel, Field

from app.activities.dto.activity_dto import WordPackItem
from app.roadmaps.services.roadmap_ai_service import RoadmapAiService

_SYSTEM = (
    "Bạn tạo bộ từ cho trò chơi vẽ-và-đoán (kiểu Pictionary) để nhóm học sinh viên giải lao. "
    "Từ phải là danh từ hoặc cụm danh từ tiếng Việt ngắn (1 đến 4 tiếng), CÓ THỂ VẼ ĐƯỢC bằng hình đơn giản, "
    "liên quan trực tiếp tới chủ đề học được cung cấp. Không dùng từ tục, tên riêng người thật, từ trừu tượng không vẽ được. "
    "Độ khó: 1 = ai cũng vẽ và đoán được, 2 = cần biết chủ đề, 3 = thuật ngữ chuyên sâu nhưng vẫn vẽ được. "
    "Trả về đúng 40 từ, không trùng, viết thường trừ tên riêng, mỗi từ kèm độ khó."
)

_GEMINI_SCHEMA = {
    "type": "object",
    "properties": {
        "words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"word": {"type": "string"}, "difficulty": {"type": "integer"}},
                "required": ["word", "difficulty"],
            },
        }
    },
    "required": ["words"],
}


class _WordPackOutput(BaseModel):
    words: list[WordPackItem] = Field(default_factory=list)


class WordPackService:
    def __init__(self) -> None:
        self._ai = RoadmapAiService()

    async def generate(self, topic: str) -> list[WordPackItem]:
        result = await self._ai._generate(
            content=f"Chủ đề học của nhóm:\n{topic}",
            system=_SYSTEM,
            output_model=_WordPackOutput,
            gemini_schema=_GEMINI_SCHEMA,
        )
        seen: set[str] = set()
        words: list[WordPackItem] = []
        for item in result.words:
            word = " ".join(item.word.split()).strip(" .,;:!?\"'")
            key = word.lower()
            if not word or key in seen or len(word) > 40:
                continue
            seen.add(key)
            words.append(WordPackItem(word=word, difficulty=min(3, max(1, item.difficulty))))
        return words[:60]
