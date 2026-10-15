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

    client = OpenAI(api_key=settings.llm_api_key, base_url=settings.llm_base_url or None)
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


LONG_TRANSCRIPT_CHARS = 60_000  # roughly 15k tokens; beyond this, summarise in parts so nothing is truncated
PART_CHARS = 40_000


def _split_parts(text: str, size: int = PART_CHARS) -> list[str]:
    """Splits on paragraph boundaries so a part never cuts a sentence in half where avoidable."""
    parts, current = [], ""
    for para in text.split("\n\n"):
        if current and len(current) + len(para) > size:
            parts.append(current)
            current = ""
        while len(para) > size:  # a single enormous paragraph
            parts.append(para[:size])
            para = para[size:]
        current += ("\n\n" if current else "") + para
    if current:
        parts.append(current)
    return parts


def _merge(partials: list[dict]) -> dict:
    merged = {"overview": " ".join(p.get("overview", "") for p in partials).strip()}
    for key in ("key_concepts", "definitions", "examples", "revision_questions"):
        seen, items = set(), []
        for p in partials:
            for item in p.get(key, []):
                if item not in seen:
                    seen.add(item)
                    items.append(item)
        merged[key] = items
    merged["source"] = partials[0].get("source", "stub")
    return merged


def generate_summary(transcript_text: str) -> dict:
    """Summarises the COMPLETE transcript. A long one is summarised part by part and merged, never cut off."""
    summarize = _stub_summary if not settings.llm_configured else _openai_summary
    if len(transcript_text) <= LONG_TRANSCRIPT_CHARS:
        return summarize(transcript_text)
    partials = [summarize(part) for part in _split_parts(transcript_text)]
    result = _merge(partials)
    result["parts_summarized"] = len(partials)
    return result
