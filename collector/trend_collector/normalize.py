import re
import unicodedata

_SPACE = re.compile(r"\s+")
_PUNCT = re.compile(r"[\u200b\u200c\u200d\ufeff\"'`´“”‘’·•|/\\()\[\]{}<>:_\-]+")

def clean_display_keyword(text):
    text = unicodedata.normalize("NFKC", text or "")
    text = text.replace("\xa0", " ").strip()
    text = _SPACE.sub(" ", text)
    text = re.sub(r"^\s*\d{1,2}\s*[.)\-:]?\s*", "", text)
    return text.strip()

def normalize_keyword(text):
    text = clean_display_keyword(text).lower()
    text = _PUNCT.sub(" ", text)
    return _SPACE.sub(" ", text).strip()

def is_reasonable_keyword(text):
    text = clean_display_keyword(text)
    if not text or len(text) > 80:
        return False
    blocked = {
        "실시간 검색어", "최근 변경", "나무뉴스", "로그인", "회원가입",
        "검색", "더 보기", "더보기", "namuwiki"
    }
    return text.lower() not in {x.lower() for x in blocked}
