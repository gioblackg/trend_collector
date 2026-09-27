from dataclasses import dataclass, field, asdict
from typing import Any

@dataclass
class SourceItem:
    keyword: str
    rank: int | None = None
    value: float | None = None
    value_label: str | None = None
    published_at: str | None = None
    url: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self):
        return asdict(self)

@dataclass
class SourceResult:
    source: str
    status: str
    items: list[SourceItem] = field(default_factory=list)
    error: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self):
        return {
            "source": self.source,
            "status": self.status,
            "items": [x.to_dict() for x in self.items],
            "error": self.error,
            "meta": self.meta,
        }
