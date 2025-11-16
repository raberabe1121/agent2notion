from flask import Flask, request, jsonify, send_from_directory
import requests
import json
import re
import os
from datetime import datetime
from dotenv import load_dotenv

# 環境変数の読み込み
load_dotenv()

app = Flask(__name__)

# Notion認証情報
NOTION_TOKEN = os.getenv("NOTION_TOKEN")
DATABASE_ID = os.getenv("NOTION_DATABASE_ID")

# CORS対応（ChatGPT Plugin用）
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    return response

@app.route("/parse", methods=["POST"])
def parse():
    """AgentのJSON出力を構造化"""
    try:
        raw_text = request.json.get("text", "")
        data = json.loads(raw_text)
        parsed = []
        
        for item in data:
            # 価格と評価の抽出
            price_match = re.search(r'¥([\d,]+)', item.get('price', ''))
            rating_match = re.search(r'(\d\.\d)', item.get('rating', ''))
            
            parsed.append({
                "product": item.get("product"),
                "price": int(price_match.group(1).replace(',', '')) if price_match else None,
                "rating": float(rating_match.group(1)) if rating_match else None,
                "timestamp": datetime.utcnow().isoformat()
            })
        
        return jsonify(parsed)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/notion/import", methods=["POST"])
def import_to_notion():
    """Notion DBへ登録"""
    try:
        records = request.json.get("records", [])
        
        if not NOTION_TOKEN or not DATABASE_ID:
            return jsonify({
                "error": "NOTION_TOKEN or DATABASE_ID not configured"
            }), 500
        
        headers = {
            "Authorization": f"Bearer {NOTION_TOKEN}",
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28"
        }
        
        results = []
        errors = []
        
        for r in records:
            payload = {
                "parent": {"database_id": DATABASE_ID},
                "properties": {
                    "Product": {"title": [{"text": {"content": r["product"]}}]},
                    "Price (JPY)": {"number": r["price"]},
                    "Rating": {"number": r["rating"]},
                    "Timestamp": {"date": {"start": r["timestamp"]}}
                }
            }
            
            res = requests.post(
                "https://api.notion.com/v1/pages",
                headers=headers,
                json=payload
            )
            
            results.append(res.status_code)
            
            if res.status_code != 200:
                errors.append({
                    "product": r["product"],
                    "status": res.status_code,
                    "error": res.json()
                })
        
        response = {
            "status": "ok" if len(errors) == 0 else "partial",
            "imported": len([r for r in results if r == 200]),
            "total": len(records),
            "responses": results
        }
        
        if errors:
            response["errors"] = errors
        
        return jsonify(response)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/health", methods=["GET"])
def health():
    """ヘルスチェック"""
    return jsonify({
        "status": "running",
        "notion_configured": bool(NOTION_TOKEN and DATABASE_ID)
    })

if __name__ == "__main__":
    app.run(port=8080, debug=True)
