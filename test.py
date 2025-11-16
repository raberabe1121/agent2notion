#!/usr/local/bin/python3 -OO
# -*- coding: utf-8 -*-

import json
import re
from datetime import datetime, UTC  # ✅ UTCをインポート

raw = '''
[
  {
    "product": "Anker Soundcore Life P2 Mini 完全ワイヤレスイヤホン（ブラック）",
    "price": "¥4,490",
    "rating": "4.3/5 ★ (18,432件の評価)"
  },
  {
    "product": "AOKIMI V12 完全ワイヤレスイヤホン（2025年最新版）",
    "price": "¥3,429（最低価格 ¥2,099）",
    "rating": "4.4/5 ★ (10,878件の評価)"
  },
  {
    "product": "Anker Soundcore P40i 完全ワイヤレスイヤホン",
    "price": "¥7,990",
    "rating": "4.3/5 ★ (11,083件の評価)"
  }
]
'''

def alternative_approach(raw_text):
    data = json.loads(raw_text)
    parsed = []
    for item in data:
        price_match = re.search(r'¥([\d,]+)', item.get('price', ''))
        rating_match = re.search(r'(\d\.\d)', item.get('rating', ''))
        parsed.append({
            "product": item.get("product"),
            "price": int(price_match.group(1).replace(',', '')) if price_match else None,
            "rating": float(rating_match.group(1)) if rating_match else None,
            "timestamp": datetime.now(UTC).isoformat()
        })
    return parsed

structured = alternative_approach(raw)
print(structured)
