"""AI-assisted feedback: the assistant that turns a feedback message into a well-formed request.

Modules: ``constants`` (checklist, limits, prompt version), ``text`` (normalisation, Arabic aware), ``search``
(``RequestSearch``, lexical), ``knowledge`` (the generated ``platform`` pack and project facts), ``schemas``
(the proposal), ``tools`` (what the model may call), ``prompts``, ``connection`` (the admin connection and the
model client), ``agent`` (the turn loop, streaming), ``requests`` (rows, references, listing, confirm),
``triage`` (administrator actions) and ``retention`` (draft purge). See
``docs/internal/feature-rounds/2026-10-ai-feedback/spec-e.md``.
"""
