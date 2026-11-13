# -*- coding: utf-8 -*-
"""ELSEWHEN 음원 내려받기.

Freesound 에 공개된 실제 녹음 가운데 CC0(퍼블릭 도메인) 음원만 받는다.
각 음원 페이지에서 라이선스를 확인하고, CC0 가 아니면 받지 않는다.
받는 파일은 Freesound 가 제공하는 고음질 미리듣기 MP3 다.

사용법: python -I tools/fetch_audio.py assets/audio
"""
import io
import json
import os
import re
import sys
import urllib.request

SOUNDS = [
    ("loom", 582994),        # 나무 수동 베틀
    ("snap", 537084),        # 기타 줄이 끊어지는 소리 모음
    ("twig", 114300),        # 잔가지 꺾이는 소리
    ("harp_c4", 219228),     # 켈틱 하프 C4
    ("harp_c5", 347626),     # 켈틱 하프 C5
    ("gayageum_a2", 24551),  # 가야금 A2
    ("room", 705421),        # 빈 강당의 공기
    ("cloth", 850705),       # 천 스치는 소리
]
UA = {"User-Agent": "Mozilla/5.0"}


def get(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
        final = r.geturl()
    return (data if binary else data.decode("utf-8", "replace")), final


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    credits = []
    for name, sid in SOUNDS:
        page, final = get("https://freesound.org/s/%d/" % sid)
        lic = re.findall(r'href="(https?://creativecommons\.org/[^"]+)"', page)
        lic = [l for l in lic if "/licenses/" in l or "/publicdomain/" in l]
        m = re.search(r"/people/([^/]+)/sounds/%d" % sid, final)
        author = m.group(1) if m else "?"
        t = re.search(r"<title>([^<]*)</title>", page)
        title = t.group(1).strip() if t else "?"
        mp3 = re.search(r'data-mp3="(https://cdn\.freesound\.org/previews/[^"]+?)-lq\.mp3"', page)
        cc0 = bool(lic) and "publicdomain/zero" in lic[0]
        print("%-12s %d  author=%s  license=%s" % (name, sid, author, lic[0] if lic else "NOT FOUND"))
        if not cc0 or not mp3:
            print("   -> skipped (CC0 not confirmed or no preview)")
            continue
        data, _ = get(mp3.group(1) + "-hq.mp3", binary=True)
        path = os.path.join(out, name + ".mp3")
        with open(path, "wb") as f:
            f.write(data)
        print("   -> %s (%d KB)" % (path, len(data) // 1024))
        credits.append({"file": name + ".mp3", "title": title, "author": author,
                        "source": "https://freesound.org/s/%d/" % sid, "license": lic[0]})
    with io.open(os.path.join(out, "credits.json"), "w", encoding="utf-8") as f:
        json.dump(credits, f, ensure_ascii=False, indent=2)
    print("wrote credits.json (%d sounds)" % len(credits))


if __name__ == "__main__":
    main()
