# -*- coding: utf-8 -*-
"""ELSEWHEN 데이터 빌드 스크립트.

입력
  1) UN 세계인구전망 2024, Demographic Indicators (Medium) CSV.gz
     https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_Demographic_Indicators_Medium.csv.gz
  2) 세계은행 도시 인구 비율 (SP.URB.TOTL.IN.ZS) API 응답 JSON
     https://api.worldbank.org/v2/country/IN;CN;NG;PK;ID;CD;ET;US;BR;KR;JP;DE/indicator/SP.URB.TOTL.IN.ZS?format=json&per_page=2000&date=1960:2023

출력
  data/demography.json

사용법
  python -I tools/build_data.py <wpp.csv.gz> <worldbank_urban.json> <out.json>

사망률은 UN이 공개한 요약 지표(IMR, Q5, Q0040, Q1550, Q1560, Q0060, LE65, LE80)를
기준점으로 저장한다. 60세 이후는 곰페르츠 곡선 mu(x) = A * exp(B * (x - 60)) 의
A, B 를 LE65 와 LE80 에 맞춰 구한다. 한 살 단위 사망 확률은 게임의 world.js 가
이 기준점에서 복원한다.
"""
import csv
import gzip
import json
import math
import sys

COUNTRIES = [
    ("IND", "IN", "인도"),
    ("CHN", "CN", "중국"),
    ("NGA", "NG", "나이지리아"),
    ("PAK", "PK", "파키스탄"),
    ("IDN", "ID", "인도네시아"),
    ("COD", "CD", "콩고민주공화국"),
    ("ETH", "ET", "에티오피아"),
    ("USA", "US", "미국"),
    ("BRA", "BR", "브라질"),
    ("KOR", "KR", "대한민국"),
    ("JPN", "JP", "일본"),
    ("DEU", "DE", "독일"),
]
YEARS5 = list(range(1950, 2101, 5))
BIRTH_YEARS = list(range(1950, 2001))
BOUNDARY_YEAR = 2024  # 이 해부터 UN 중위 전망


def remaining_life(a, b, start, step=0.5, end=125.0):
    """곰페르츠 위험률에서 start 세의 기대여명."""
    total = 0.0
    surv = 1.0
    x = start
    k = a / b
    while x < end and surv > 1e-7:
        nxt = surv * math.exp(-k * (math.exp(b * (x + step - 60.0)) - math.exp(b * (x - 60.0))))
        total += 0.5 * (surv + nxt) * step
        surv = nxt
        x += step
    return total


def fit_gompertz(le65, le80):
    """LE65, LE80 을 동시에 만족하는 (A, B)."""

    def a_for(b):
        lo, hi = 1e-5, 0.5
        for _ in range(34):
            mid = math.sqrt(lo * hi)
            if remaining_life(mid, b, 80.0) > le80:
                lo = mid
            else:
                hi = mid
        return math.sqrt(lo * hi)

    lo, hi = 0.03, 0.20
    for _ in range(26):
        mid = 0.5 * (lo + hi)
        a = a_for(mid)
        if remaining_life(a, mid, 65.0) < le65:
            lo = mid
        else:
            hi = mid
    b = 0.5 * (lo + hi)
    return a_for(b), b


def r(x, n=5):
    if x == 0:
        return 0
    return float("%.*g" % (n, x))


def main():
    wpp_path, urban_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    iso3 = {c[0] for c in COUNTRIES}
    rows = {}
    with gzip.open(wpp_path, "rt", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if row["ISO3_code"] in iso3 and row["Variant"] == "Medium":
                rows[(row["ISO3_code"], int(row["Time"]))] = row

    with open(urban_path, "r", encoding="utf-8") as f:
        wb = json.load(f)
    urban = {}
    for item in wb[1]:
        if item["value"] is not None:
            urban.setdefault(item["country"]["id"], {})[int(item["date"])] = item["value"] / 100.0

    out = {
        "source": {
            "mortality": "UN World Population Prospects 2024, Demographic Indicators, Medium variant",
            "urban": "World Bank SP.URB.TOTL.IN.ZS (1960-2023). 1950-1959 는 1960 값, 2024 이후는 2023 값으로 고정",
            "note": "1950-2023 은 UN 추정치, 2024-2100 은 UN 중위 전망",
        },
        "boundaryYear": BOUNDARY_YEAR,
        "years": YEARS5,
        "birthYears": [BIRTH_YEARS[0], BIRTH_YEARS[-1]],
        "mortFields": ["imr", "q5", "l15", "l40", "l50", "l60", "A", "B"],
        "countries": {},
    }

    for code3, code2, name in COUNTRIES:
        missing = [y for y in range(1950, 2101) if (code3, y) not in rows]
        if missing:
            raise SystemExit("missing years for %s: %s..." % (code3, missing[:5]))
        u = urban[code2]
        u_years = sorted(u)
        entry = {
            "name": name,
            "births": [r(float(rows[(code3, y)]["Births"]), 6) for y in BIRTH_YEARS],
            "srb": [],
            "e0": [],
            "tfr": [],
            "urban": [],
            "mort": {"M": [], "F": []},
        }
        for y in YEARS5:
            row = rows[(code3, y)]
            entry["e0"].append(r(float(row["LEx"]), 4))
            entry["tfr"].append(r(float(row["TFR"]), 4))
            entry["srb"].append(r(float(row["SRB"]), 4))
            uy = min(max(y, u_years[0]), u_years[-1])
            entry["urban"].append(r(u[uy], 3))
            imr = float(row["IMR"]) / 1000.0
            q5 = float(row["Q5"]) / 1000.0
            for sex, suffix in (("M", "Male"), ("F", "Female")):
                l40 = 1.0 - float(row["Q0040" + suffix]) / 1000.0
                l60 = 1.0 - float(row["Q0060" + suffix]) / 1000.0
                l15 = l60 / (1.0 - float(row["Q1560" + suffix]) / 1000.0)
                l50 = l15 * (1.0 - float(row["Q1550" + suffix]) / 1000.0)
                a, b = fit_gompertz(float(row["LE65" + suffix]), float(row["LE80" + suffix]))
                # 5세 미만 사망은 남녀 합계 값만 공개되므로 l15 를 넘지 않게만 맞춘다.
                q5s = q5 if (1.0 - q5) > l15 else (1.0 - l15) * 0.8
                imrs = min(imr, q5s * 0.95)
                entry["mort"][sex].append([r(imrs), r(q5s), r(l15, 6), r(l40, 6), r(l50, 6), r(l60, 6), r(a), r(b)])
        out["countries"][code3] = entry
        print(code3, name, "e0 1950/2000/2050/2100 =", entry["e0"][0], entry["e0"][10], entry["e0"][20], entry["e0"][30])

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", out_path)


if __name__ == "__main__":
    main()
