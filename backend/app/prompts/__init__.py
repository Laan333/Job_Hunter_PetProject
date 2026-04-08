"""LLM prompt strings (no inline prompts in routers)."""

from app.prompts.cover import COVER_LETTER_SYSTEM, COVER_LETTER_USER_TEMPLATE
from app.prompts.match import MATCH_ANALYSIS_SYSTEM, MATCH_ANALYSIS_USER_TEMPLATE
from app.prompts.vacancy_screening_qa import SCREENING_QA_SYSTEM, SCREENING_QA_USER_TEMPLATE

__all__ = [
    "MATCH_ANALYSIS_SYSTEM",
    "MATCH_ANALYSIS_USER_TEMPLATE",
    "COVER_LETTER_SYSTEM",
    "COVER_LETTER_USER_TEMPLATE",
    "SCREENING_QA_SYSTEM",
    "SCREENING_QA_USER_TEMPLATE",
]
