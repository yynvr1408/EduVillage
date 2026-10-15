"""Turns a transcript into a structured summary.

Without an LLM_API_KEY, generate_summary falls back to a clearly-labeled stub (naive
truncation/splitting, no model call) so the pipeline is testable end to end without a
provider account. It is never presented as a real AI result — "source" says which path
produced it, and the frontend/teacher-review flow must surface that honestly.
"""

import json

from app.config import get_settings

settings = get_settings()

SUMMARY_SCHEMA_KEYS = {"overview", "key_concepts", "definitions", "examples", "revision_questions"}


def _stub_summary(transcript_text: str) -> dict:
    sentences = [s.strip() for s in transcript_text.replace("\n", " ").split(".") if s.strip()]
    overview = ". ".join(sentences[:2]) + ("." if sentences else "")
    return {
        "overview": overview or "Transcript was too short to summarize.",
        "key_concepts": sentences[2:5],
        "definitions": [],
        "examples": sentences[5:7],
        "revision_questions": [f"What does this mean: \"{s}\"?" for s in sentences[:3]],
        "source": "stub",
    }


def _openai_summary(transcript_text: str) -> dict:
    from openai import OpenAI

    client = OpenAI(api_key=settings.llm_api_key)
    prompt = (
        "You are generating a study aid from a class transcript. "
        "Return strict JSON with keys: overview (string), key_concepts (list of strings), "
        "definitions (list of strings), examples (list of strings), revision_questions (list of strings). "
        "Only use information present in the transcript; do not invent facts.\n\n"
        f"Transcript:\n{transcript_text}"
    )
    response = client.chat.completions.create(
        model=settings.llm_model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    data = json.loads(response.choices[0].message.content)
    data["source"] = "llm"
    return data


def generate_summary(transcript_text: str) -> dict:
    if not settings.llm_configured:
        return _stub_summary(transcript_text)
    return _openai_summary(transcript_text)
