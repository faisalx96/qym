"""Validation errors with schema-owned locations and no submitted field names."""

from __future__ import annotations

from typing import get_args

from pydantic import BaseModel, ValidationError


def safe_errors(
    model: type[BaseModel], exc: ValidationError, prefix=("body",)
) -> list[dict]:
    """Keep valid field errors stable; collapse unknown keys to a count."""
    names = set()
    seen = set()

    def fields(annotation):
        if isinstance(annotation, type) and issubclass(annotation, BaseModel):
            if annotation in seen:
                return
            seen.add(annotation)
            names.update(annotation.model_fields)
            for field in annotation.model_fields.values():
                fields(field.annotation)
        else:
            for argument in get_args(annotation):
                fields(argument)

    fields(model)
    errors = []
    unknown = 0
    for error in exc.errors(include_input=False, include_context=False):
        if error["type"] == "extra_forbidden":
            unknown += 1
            continue
        location = tuple(
            part if isinstance(part, int) or part in names else "field"
            for part in error["loc"]
        )
        errors.append({**error, "loc": (*prefix, *location)})
    if unknown:
        errors.append(
            {
                "type": "extra_forbidden",
                "loc": prefix,
                "msg": "Unknown fields are not allowed",
                "ctx": {"count": unknown},
            }
        )
    return errors
