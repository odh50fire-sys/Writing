#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
동도 롸이팅 마스터 (Dongdo Writing Master) - 로컬 웹 백엔드 서버
Python 3 표준 라이브러리만 사용하여 외부 의존성(pip) 없이 100% 동작합니다.
"""

import os
import sys
import json
import re
import shutil
import datetime
import unicodedata
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CURRICULUM_DIR = os.path.join(DATA_DIR, "curriculum")
USERS_DIR = os.path.join(DATA_DIR, "users")
WEB_DIR = os.path.join(BASE_DIR, "web")

def normalize_symbol(sym):
    if not sym:
        return ""
    norm = unicodedata.normalize("NFKD", str(sym)).strip().lower()
    return re.sub(r'[^a-z0-9]', '', norm)

CONTRACTIONS = [
    ("doesn't", "does not"),
    ("don't", "do not"),
    ("didn't", "did not"),
    ("can't", "cannot"),
    ("can't", "can not"),
    ("isn't", "is not"),
    ("aren't", "are not"),
    ("wasn't", "was not"),
    ("weren't", "were not"),
    ("couldn't", "could not"),
    ("won't", "will not"),
    ("i'm", "i am"),
    ("he's", "he is"),
    ("she's", "she is"),
    ("it's", "it is"),
    ("we're", "we are"),
    ("they're", "they are"),
    ("there's", "there is"),
    ("i'd", "i would"),
    ("you'd", "you would"),
    ("he'd", "he would")
]

def expand_contractions(text):
    if not text:
        return ""
    t = text.lower().replace("’", "'").replace("‘", "'")
    for short, long in CONTRACTIONS:
        t = re.sub(r'\b' + re.escape(short) + r'\b', long, t)
    return t

def clean_words(text):
    expanded = expand_contractions(text)
    clean = re.sub(r'[^a-zA-Z0-9\s]', ' ', expanded)
    return clean.split()

PAST_TO_BASE = {
    'went': 'go', 'saw': 'see', 'gave': 'give', 'made': 'make', 'ran': 'run',
    'ate': 'eat', 'bought': 'buy', 'wrote': 'write', 'took': 'take', 'came': 'come',
    'met': 'meet', 'found': 'find', 'told': 'tell', 'read': 'read', 'drank': 'drink',
    'spoke': 'speak', 'heard': 'hear', 'built': 'build', 'sent': 'send', 'spent': 'spend',
    'taught': 'teach', 'caught': 'catch', 'brought': 'bring', 'felt': 'feel', 'left': 'leave',
    'slept': 'sleep', 'lost': 'lose', 'became': 'become', 'won': 'win', 'understood': 'understand',
    'knew': 'know', 'thought': 'think', 'broke': 'break', 'began': 'begin', 'chose': 'choose',
    'drove': 'drive', 'fell': 'fall', 'forgot': 'forget', 'grew': 'grow', 'hid': 'hide',
    'kept': 'keep', 'rode': 'ride', 'rose': 'rise', 'sang': 'sing', 'sat': 'sit',
    'swam': 'swim', 'threw': 'throw', 'wore': 'wear'
}

NON_VERB_S_WORDS = {
    'this', 'us', 'always', 'yes', 'bus', 'class', 'sometimes', 'gas', 'grass', 'glass',
    'delicious', 'various', 'famous', 'his', 'its', 'is', 'was', 'has', 'does', 'as', 'news'
}

def check_type_a_grammar(student_ans, sample_ans):
    deductions = []
    score_cut = 0

    std_words = clean_words(student_ans)
    sample_words = clean_words(sample_ans)

    # 1. Be-verb agreement check:
    if 'are' in sample_words and 'are' not in std_words:
        if 'is' in std_words:
            deductions.append("주어와 동사의 수 일치 오류: 복수 주어 뒤에는 are를 써야 하나 is를 사용함 (-25점)")
            score_cut += 25
        elif 'am' in std_words:
            deductions.append("주어와 동사의 수 일치 오류: are를 써야 하나 am을 사용함 (-25점)")
            score_cut += 25

    if 'is' in sample_words and 'is' not in std_words:
        if 'are' in std_words:
            deductions.append("주어와 동사의 수 일치 오류: 3인칭 단수 주어 뒤에는 is를 써야 하나 are를 사용함 (-25점)")
            score_cut += 25

    # 2. 3rd person singular -s check (dynamic & pinpoint):
    for sam_w in sample_words:
        if sam_w in NON_VERB_S_WORDS:
            continue
        base = None
        if sam_w.endswith("ies") and len(sam_w) > 4:
            base = sam_w[:-3] + "y"
        elif sam_w.endswith("es") and len(sam_w) > 3 and any(sam_w[:-2].endswith(ch) for ch in ["ch", "sh", "ss", "x", "o"]):
            base = sam_w[:-2]
        elif sam_w.endswith("s") and len(sam_w) > 2 and not sam_w.endswith("ss"):
            base = sam_w[:-1]
        
        if base and sam_w not in std_words and base in std_words:
            deductions.append(f"3인칭 단수 현재형 동사 변형 오류: 주어가 3인칭 단수이므로 '{base}' 뒤에 -s(또는 -es)를 붙여 '{sam_w}'로 써야 합니다 (-20점)")
            score_cut += 20
            break

    # 3. Past tense check (irregular & regular):
    for sam_w in sample_words:
        base = PAST_TO_BASE.get(sam_w)
        if base and sam_w not in std_words and (base in std_words or f"{base}s" in std_words):
            deductions.append(f"시제 일치 오류: 과거 시제 동사 '{sam_w}'를 써야 하나 현재형 '{base}'을 사용함 (-20점)")
            score_cut += 20
            break
        elif sam_w.endswith("ed") and len(sam_w) > 3 and sam_w not in std_words:
            base_reg = sam_w[:-2] if sam_w.endswith("ed") and not sam_w.endswith("ied") else (sam_w[:-3] + "y")
            if base_reg in std_words or f"{base_reg}s" in std_words:
                deductions.append(f"시제 일치 오류: 과거 시제 동사 '{sam_w}'를 써야 하나 현재형 '{base_reg}'을 사용함 (-20점)")
                score_cut += 20
                break

    # 4. Subjunctive check:
    if 'were' in sample_words and 'were' not in std_words and 'was' in std_words:
        deductions.append("가정법 과거 be동사 오류: 가정법 과거 if절에서는 was가 아닌 were를 쓰는 것이 원칙입니다 (-20점)")
        score_cut += 20

    # 5. Relative pronoun check:
    if 'who' in sample_words and 'who' not in std_words and 'which' in std_words:
        deductions.append("관계대명사 선택 오류: 선행사가 사람일 때는 which가 아닌 who(또는 that)를 써야 합니다 (-20점)")
        score_cut += 20
    if 'which' in sample_words and 'which' not in std_words and 'who' in std_words:
        deductions.append("관계대명사 선택 오류: 선행사가 사물일 때는 who가 아닌 which(또는 that)를 써야 합니다 (-20점)")
        score_cut += 20

    return deductions, score_cut

def levenshtein_dist(s1, s2):
    if len(s1) < len(s2):
        return levenshtein_dist(s2, s1)
    if len(s2) == 0:
        return len(s1)
    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
    return previous_row[-1]

def find_spelling_typos(student_words, sample_words):
    typos = []
    used_stu = set()
    used_sam = set()

    for sw in sample_words:
        sw_low = sw.lower()
        if sw_low in [w.lower() for w in student_words]:
            continue
        for stu_w in student_words:
            stu_low = stu_w.lower()
            if stu_low in used_stu or stu_low in [w.lower() for w in sample_words]:
                continue
            is_anagram = (len(stu_low) == len(sw_low) and sorted(stu_low) == sorted(sw_low))
            dist = levenshtein_dist(stu_low, sw_low)
            is_close = (len(sw_low) >= 4 and dist <= 2) or (len(sw_low) <= 3 and dist == 1)
            
            is_inflection = (
                stu_low + 's' == sw_low or stu_low + 'es' == sw_low or
                sw_low + 's' == stu_low or sw_low + 'es' == stu_low or
                stu_low + 'd' == sw_low or stu_low + 'ed' == sw_low or
                sw_low + 'd' == stu_low or sw_low + 'ed' == stu_low
            )

            if (is_anagram or is_close) and not is_inflection:
                typos.append({"wrong": stu_w, "correct": sw})
                used_stu.add(stu_low)
                used_sam.add(sw_low)
                break
    return typos

def check_type_a_praises(student_ans, sample_ans):
    praises = []
    std_words = clean_words(student_ans.lower())
    sample_words = clean_words(sample_ans.lower())
    
    # 3rd person singular -s
    for v in ['gets', 'cleans', 'likes', 'wants', 'teaches', 'reads', 'makes', 'eats', 'runs', 'walks', 'helps', 'studies']:
        if v in sample_words and v in std_words:
            praises.append(f"주어에 맞춘 3인칭 단수 동사 변형 '{v}'을 정확히 작성했습니다!")
            break
            
    # Past tense
    for v in ['went', 'saw', 'gave', 'made', 'ran', 'played', 'visited', 'bought', 'cooked']:
        if v in sample_words and v in std_words:
            praises.append(f"과거 시제 동사 '{v}'을 정확히 반영했습니다!")
            break
            
    # Present perfect
    if ('have' in sample_words or 'has' in sample_words) and ('have' in std_words or 'has' in std_words):
        for v in ['lived', 'been', 'seen', 'studied', 'stayed', 'known']:
            if v in sample_words and v in std_words:
                praises.append("현재완료(have/has + p.p.) 구문을 정확히 구사했습니다!")
                break
                
    # Relative pronoun
    if ('who' in sample_words and 'who' in std_words) or ('which' in sample_words and 'which' in std_words) or ('that' in sample_words and 'that' in std_words):
        praises.append("알맞은 관계대명사를 정확하게 연결했습니다!")
        
    # Modal verbs & negatives
    if ("cannot" in sample_words or "can't" in sample_words) and ("cannot" in std_words or "can't" in std_words or "cannot" in expand_contractions(student_ans).lower()):
        praises.append("조동사 can의 부정 표현을 올바르게 적용했습니다!")
        
    return praises

def load_json(filepath, default=None):
    if not os.path.exists(filepath):
        return default
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[Error] load_json {filepath}: {e}")
        return default

def save_json(filepath, data):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

class WritingAppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path.startswith("/api/"):
            try:
                self.handle_api_get(path, query)
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_json({"success": False, "message": str(e)}, 500)
        else:
            # 기본 웹 정적 파일 제공
            if path == "/" or path == "":
                self.path = "/index.html"
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        try:
            payload = json.loads(body) if body else {}
        except Exception:
            payload = {}

        if path.startswith("/api/"):
            try:
                self.handle_api_post(path, payload)
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_json({"success": False, "message": str(e)}, 500)
        else:
            self.send_error(404, "Not Found")

    def send_json(self, data, status=200):
        response_bytes = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)
        self.wfile.flush()

    # ==========================
    # API GET 라우터
    # ==========================
    def handle_api_get(self, path, query):
        if path == "/api/users":
            users_meta = load_json(os.path.join(USERS_DIR, "users.json"), {"activeUserId": "minho", "users": []})
            self.send_json(users_meta)

        elif path == "/api/user/data":
            user_id = query.get("userId", ["minho"])[0]
            user_dir = os.path.join(USERS_DIR, user_id)
            if not os.path.exists(user_dir):
                user_id = "minho"
                user_dir = os.path.join(USERS_DIR, user_id)

            data = {
                "userId": user_id,
                "stats": load_json(os.path.join(user_dir, "stats.json"), {}),
                "settings": load_json(os.path.join(user_dir, "settings.json"), {"dailyTargetMinutes": 30}),
                "wrongNotes": load_json(os.path.join(user_dir, "wrong_notes.json"), []),
                "essays": load_json(os.path.join(user_dir, "essays.json"), []),
                "history": load_json(os.path.join(user_dir, "history.json"), [])
            }
            self.send_json(data)

        elif path == "/api/catalog":
            catalog = load_json(os.path.join(CURRICULUM_DIR, "catalog.json"), {"textbooks": []})
            self.send_json(catalog)

        elif path == "/api/textbook":
            tb_id = query.get("id", ["ybm_park_grade1"])[0]
            tb_path = os.path.join(CURRICULUM_DIR, f"{tb_id}.json")
            tb_data = load_json(tb_path, {})
            self.send_json(tb_data)

        elif path == "/api/daily_routine":
            tb_id = query.get("textbookId", ["ybm_park_grade1"])[0]
            unit_num = int(query.get("unit", [1])[0])
            tb_path = os.path.join(CURRICULUM_DIR, f"{tb_id}.json")
            tb_data = load_json(tb_path, {})
            
            unit_data = None
            for u in tb_data.get("units", []):
                if u.get("unit") == unit_num:
                    unit_data = u
                    break
            if not unit_data and tb_data.get("units"):
                unit_data = tb_data["units"][0]

            routine = {
                "textbookTitle": tb_data.get("title", "YBM(박준언) 중1"),
                "unit": unit_data.get("unit", 1),
                "title": unit_data.get("title", ""),
                "targetGrammar": unit_data.get("targetGrammar", []),
                "step1_warmup": unit_data.get("warmup", []),
                "step2_typeA": unit_data.get("typeA", []),
                "step3_typeB": unit_data.get("typeB", []),
                "step4_typeD": unit_data.get("typeD", [])
            }
            self.send_json(routine)

        elif path == "/api/session":
            user_id = query.get("userId", ["minho"])[0]
            session_path = os.path.join(USERS_DIR, user_id, "session.json")
            session_data = load_json(session_path, {})
            self.send_json(session_data)

        else:
            self.send_error(404, "API endpoint not found")

    # ==========================
    # API POST 라우터
    # ==========================
    def handle_api_post(self, path, payload):
        if path == "/api/users/switch":
            user_id = payload.get("userId", "minho")
            users_meta_path = os.path.join(USERS_DIR, "users.json")
            users_meta = load_json(users_meta_path, {"activeUserId": "minho", "users": []})
            users_meta["activeUserId"] = user_id
            save_json(users_meta_path, users_meta)
            self.send_json({"success": True, "activeUserId": user_id, "users": users_meta["users"]})

        elif path == "/api/users/add":
            new_id = payload.get("id", "").strip().lower()
            name = payload.get("name", "").strip()
            grade = int(payload.get("grade", 1))
            avatar = payload.get("avatar", "🐥")
            
            if not new_id or not name:
                self.send_json({"success": False, "message": "ID와 이름을 입력하세요."}, 400)
                return

            users_meta_path = os.path.join(USERS_DIR, "users.json")
            users_meta = load_json(users_meta_path, {"activeUserId": "minho", "users": []})
            
            # 중복 체크
            for u in users_meta["users"]:
                if u["id"] == new_id:
                    self.send_json({"success": False, "message": "이미 존재하는 ID입니다."}, 400)
                    return

            users_meta["users"].append({
                "id": new_id,
                "name": name,
                "grade": grade,
                "avatar": avatar,
                "targetSchool": "대구 동도중학교",
                "createdAt": datetime.date.today().isoformat()
            })
            users_meta["activeUserId"] = new_id
            save_json(users_meta_path, users_meta)

            # 새 사용자 디렉터리 생성 및 기본값 초기화
            new_user_dir = os.path.join(USERS_DIR, new_id)
            os.makedirs(new_user_dir, exist_ok=True)
            save_json(os.path.join(new_user_dir, "stats.json"), {
                "level": 1,
                "levelTitle": "새싹 영작러",
                "exp": 0,
                "nextLevelExp": 100,
                "streakDays": 1,
                "lastStudyDate": datetime.date.today().isoformat(),
                "totalStudyMinutes": 0,
                "completedProblemsCount": 0,
                "radar": {"condition": 50, "agreement": 50, "tense": 50, "mechanics": 50, "structure": 50},
                "badges": [
                    {"id": "first_step", "name": "첫 걸음", "desc": "첫 번째 영작 미션을 완료함", "icon": "🌱", "unlocked": False},
                    {"id": "streak_3", "name": "3일 연속 학습", "desc": "3일 연속으로 매일 30분 학습 달성", "icon": "🔥", "unlocked": False},
                    {"id": "subject_verb", "name": "수 일치 마스터", "desc": "3인칭 단수 -s 감점 없이 5회 연속 통과", "icon": "🎯", "unlocked": False},
                    {"id": "essay_master", "name": "수행평가 챔피언", "desc": "단락 에세이 90점 이상 달성", "icon": "👑", "unlocked": False}
                ]
            })
            save_json(os.path.join(new_user_dir, "settings.json"), {
                "dailyTargetMinutes": 30,
                "soundEnabled": True,
                "theme": "pastel_purple",
                "aiFeedbackStrictness": "normal",
                "mascot": "penny"
            })
            save_json(os.path.join(new_user_dir, "wrong_notes.json"), [])
            save_json(os.path.join(new_user_dir, "essays.json"), [])
            save_json(os.path.join(new_user_dir, "history.json"), [])

            self.send_json({
                "success": True, 
                "user": users_meta["users"][-1],
                "users": users_meta["users"],
                "activeUserId": new_id
            })

        elif path == "/api/users/delete":
            del_id = payload.get("userId", "").strip().lower()
            users_meta_path = os.path.join(USERS_DIR, "users.json")
            users_meta = load_json(users_meta_path, {"activeUserId": "minho", "users": []})
            
            if len(users_meta.get("users", [])) <= 1:
                self.send_json({"success": False, "message": "최소 한 명의 사용자 프로필은 유지되어야 합니다."}, 400)
                return

            original_len = len(users_meta["users"])
            users_meta["users"] = [u for u in users_meta["users"] if u.get("id") != del_id]

            if len(users_meta["users"]) == original_len:
                self.send_json({"success": False, "message": "해당 사용자를 찾을 수 없습니다."}, 404)
                return

            if users_meta.get("activeUserId") == del_id:
                users_meta["activeUserId"] = users_meta["users"][0]["id"]

            save_json(users_meta_path, users_meta)

            del_user_dir = os.path.join(USERS_DIR, del_id)
            if os.path.exists(del_user_dir):
                shutil.rmtree(del_user_dir, ignore_errors=True)

            self.send_json({
                "success": True,
                "deletedUserId": del_id,
                "users": users_meta["users"],
                "activeUserId": users_meta["activeUserId"]
            })

        elif path == "/api/user/settings":
            user_id = payload.get("userId", "minho")
            settings = payload.get("settings", {})
            user_dir = os.path.join(USERS_DIR, user_id)
            save_json(os.path.join(user_dir, "settings.json"), settings)
            self.send_json({"success": True})

        elif path == "/api/user/set_level":
            user_id = payload.get("userId", "minho")
            new_level = int(payload.get("level", 1))
            new_track = payload.get("track", "track1")
            rec_level = int(payload.get("recommendedLevel", new_level))
            test_score = payload.get("testScore", None)
            tb_prefix = payload.get("textbookPrefix", "ybm_park")
            
            user_dir = os.path.join(USERS_DIR, user_id)
            stats_path = os.path.join(user_dir, "stats.json")
            stats = load_json(stats_path, {})
            
            titles = ["새싹 영작러", "도약하는 영작러", "성장하는 챌린저", "문법 탐험가", "서술형 명사수", "조건영작 스페셜리스트", "동도중 에이스", "수성구 영작 달인", "내신 1등급 마스터", "수능/내신 완벽 지배자"]
            stats["level"] = max(1, min(10, new_level))
            stats["levelTitle"] = titles[stats["level"] - 1]
            stats["recommendedLevel"] = max(1, min(10, rec_level))
            stats["recommendedLevelTitle"] = titles[stats["recommendedLevel"] - 1]
            
            today_str = datetime.date.today().isoformat()
            if test_score is not None:
                stats["placementRecord"] = {
                    "score": test_score,
                    "recommendedLevel": stats["recommendedLevel"],
                    "recommendedLevelTitle": stats["recommendedLevelTitle"],
                    "selectedLevel": stats["level"],
                    "selectedLevelTitle": stats["levelTitle"],
                    "testedAt": today_str
                }
            
            stats["exp"] = (stats["level"] - 1) * 150
            stats["nextLevelExp"] = stats["level"] * 150
            if "flawlessStreak" not in stats:
                stats["flawlessStreak"] = 0
            save_json(stats_path, stats)

            settings_path = os.path.join(user_dir, "settings.json")
            settings = load_json(settings_path, {})
            settings["activeTrack"] = new_track
            save_json(settings_path, settings)

            prefix = "ybm_kim" if "kim" in tb_prefix else "ybm_park"
            rec_tb = f"{prefix}_grade3" if new_level >= 7 else (f"{prefix}_grade2" if new_level >= 4 else f"{prefix}_grade1")
            self.send_json({
                "success": True,
                "stats": stats,
                "settings": settings,
                "recommendedTextbook": rec_tb
            })

        elif path == "/api/grade":
            # 자동 루브릭 채점 엔진 (동도중 감점 규정 시뮬레이터)
            result = self.grade_answer(payload)
            self.send_json(result)

        elif path == "/api/save_routine_result":
            user_id = payload.get("userId", "minho")
            unit_title = payload.get("unitTitle", "Lesson 1")
            duration_minutes = payload.get("durationMinutes", 30)
            overall_score = payload.get("overallScore", 90)
            wrong_items = payload.get("wrongItems", [])
            essay_item = payload.get("essayItem")

            user_dir = os.path.join(USERS_DIR, user_id)
            stats_path = os.path.join(user_dir, "stats.json")
            stats = load_json(stats_path, {})

            # 1. EXP 및 레벨 계산
            earned_exp = 50 + int(overall_score * 0.5)
            stats["exp"] = stats.get("exp", 0) + earned_exp
            stats["totalStudyMinutes"] = stats.get("totalStudyMinutes", 0) + duration_minutes
            stats["completedProblemsCount"] = stats.get("completedProblemsCount", 0) + 7

            # 레벨업 체크 (레벨당 150 EXP 기준)
            current_lvl = stats.get("level", 1)
            req_exp = current_lvl * 150
            stats["nextLevelExp"] = req_exp
            if stats["exp"] >= req_exp:
                stats["level"] = current_lvl + 1
                stats["exp"] -= req_exp
                titles = ["새싹 영작러", "도약하는 영작러", "성장하는 챌린저", "문법 탐험가", "서술형 명사수", "조건영작 스페셜리스트", "동도중 에이스", "수성구 영작 달인", "내신 1등급 마스터", "수능/내신 완벽 지배자"]
                stats["levelTitle"] = titles[min(stats["level"] - 1, len(titles) - 1)]

            # 2. 스트릭(Streak) 및 무감점 콤보(Flawless Streak) 계산
            today_str = datetime.date.today().isoformat()
            last_date_str = stats.get("lastStudyDate", "")
            if last_date_str != today_str:
                stats["streakDays"] = stats.get("streakDays", 0) + 1
                stats["lastStudyDate"] = today_str

            if overall_score >= 95:
                stats["flawlessStreak"] = stats.get("flawlessStreak", 0) + 1
            else:
                stats["flawlessStreak"] = 0

            # 3. 레이더 차트 조정
            radar = stats.get("radar", {"condition": 75, "agreement": 75, "tense": 75, "mechanics": 80, "structure": 75})
            if overall_score >= 90:
                for k in radar:
                    radar[k] = min(100, radar[k] + 2)
            stats["radar"] = radar
            save_json(stats_path, stats)

            # 4. 오답노트 저장
            if wrong_items:
                wrong_path = os.path.join(user_dir, "wrong_notes.json")
                wrong_notes = load_json(wrong_path, [])
                for wi in wrong_items:
                    wrong_notes.append({
                        "id": f"wn_{int(datetime.datetime.now().timestamp() * 1000)}",
                        "problemId": wi.get("problemId"),
                        "problemType": wi.get("problemType", "typeA"),
                        "korean": wi.get("korean", ""),
                        "studentAnswer": wi.get("studentAnswer", ""),
                        "sampleAnswer": wi.get("sampleAnswer", ""),
                        "wrongPoints": wi.get("deductions", []),
                        "recordedAt": today_str,
                        "resolved": False
                    })
                save_json(wrong_path, wrong_notes)

            # 5. 에세이 저장
            if essay_item and essay_item.get("studentText"):
                essay_path = os.path.join(user_dir, "essays.json")
                essays = load_json(essay_path, [])
                essays.append({
                    "id": f"essay_{int(datetime.datetime.now().timestamp())}",
                    "unitTitle": unit_title,
                    "topic": essay_item.get("title", "수행평가 미니 에세이"),
                    "createdAt": today_str,
                    "score": essay_item.get("score", 95),
                    "studentText": essay_item.get("studentText", ""),
                    "feedback": essay_item.get("feedback", "조건을 모두 충족한 훌륭한 작문입니다.")
                })
                save_json(essay_path, essays)

            # 6. 히스토리 저장
            hist_path = os.path.join(user_dir, "history.json")
            history = load_json(hist_path, [])
            history.insert(0, {
                "date": today_str,
                "unitTitle": unit_title,
                "routineType": "Daily 30min",
                "durationMinutes": duration_minutes,
                "score": overall_score,
                "completedSteps": 4
            })
            save_json(hist_path, history[:30]) # 최근 30개 유지

            self.send_json({
                "success": True,
                "earnedExp": earned_exp,
                "newLevel": stats.get("level"),
                "streakDays": stats.get("streakDays"),
                "flawlessStreak": stats.get("flawlessStreak", 0)
            })

        elif path == "/api/resolve_wrong_note":
            user_id = payload.get("userId", "minho")
            wn_id = payload.get("wrongNoteId")
            user_dir = os.path.join(USERS_DIR, user_id)
            wrong_path = os.path.join(user_dir, "wrong_notes.json")
            wrong_notes = load_json(wrong_path, [])
            for wn in wrong_notes:
                if wn.get("id") == wn_id:
                    wn["resolved"] = True
                    break
            save_json(wrong_path, wrong_notes)
            self.send_json({"success": True})

        elif path == "/api/session":
            user_id = payload.get("userId", "minho")
            session_data = payload.get("session", {})
            user_dir = os.path.join(USERS_DIR, user_id)
            session_path = os.path.join(user_dir, "session.json")
            save_json(session_path, session_data)
            self.send_json({"success": True})

        else:
            self.send_error(404, "API endpoint not found")

    # ==========================
    # 자동 루브릭 채점 로직
    # ==========================
    def grade_answer(self, payload):
        q_type = payload.get("type", "typeA")
        student_ans = str(payload.get("studentAnswer", "")).strip()
        sample_ans = str(payload.get("sampleAnswer") or payload.get("sampleEssay") or "").strip()
        conditions = payload.get("conditions", [])
        required_words = payload.get("requiredWords", [])
        target_count = payload.get("targetWordCount")

        deductions = []
        score = 100

        if not student_ans:
            return {
                "score": 0,
                "deductions": ["답안이 입력되지 않았습니다 (-100점)"],
                "passed": False,
                "sampleAnswer": sample_ans,
                "feedback": "답안을 작성해 주세요!"
            }

        # 1. Mechanics (Type A 및 Type D 등 완전 문장 영작에만 적용, Type B 제외)
        if q_type in ("typeA", "typeD"):
            if not student_ans[0].isupper():
                deductions.append("문장 첫 글자가 소문자로 시작되었습니다 (-5점)")
                score -= 5

            if not student_ans.endswith(('.', '!', '?')):
                deductions.append("문장 끝 구두점(마침표 . 또는 느낌표 !)이 누락되었습니다 (-5점)")
                score -= 5

        # 3. Type A 채점 로직
        praises = []
        if q_type == "typeA":
            # 정밀 문법 검증 (수 일치, 3인칭 단수, 시제, 가정법, 관계사 등)
            g_deductions, g_cut = check_type_a_grammar(student_ans, sample_ans)
            deductions.extend(g_deductions)
            score -= g_cut

            # 문법적 칭찬 및 성취 요소 감지
            praises.extend(check_type_a_praises(student_ans, sample_ans))

            # 철자(스펠링) 오타 실시간 감지 (Levenshtein 및 문자 전위 체크)
            std_clean_words = clean_words(student_ans)
            sample_clean_words = clean_words(sample_ans)
            typos = find_spelling_typos(std_clean_words, sample_clean_words)
            typo_correct_words = set()
            for typo in typos:
                deductions.append(f"단어 철자(스펠링) 오류: '{typo['wrong']}' ➔ 올바른 철자는 '{typo['correct']}'입니다 (-5점)")
                score -= 5
                typo_correct_words.add(typo['correct'].lower())

            # 필수 어휘/조건 어구 포함 검사 (축약형 유연성 및 오타 분리 적용)
            for req in required_words:
                req_clean_words = clean_words(req)
                missing_words = [w for w in req_clean_words if w.lower() not in [sw.lower() for sw in std_clean_words]]
                # 오타로 이미 감점된 단어는 누락에서 제외하여 중복 감점 방지
                true_missing = [w for w in missing_words if w.lower() not in typo_correct_words]
                if true_missing:
                    deductions.append(f"필수 조건 어구 '{req}'의 일부 단어('{', '.join(true_missing)}')가 누락되었습니다 (-15점)")
                    score -= 15

            # 단어 수 조건 검사 (원문 및 축약 확장형 모두 허용)
            if target_count:
                raw_words = student_ans.split()
                exp_words = expand_contractions(student_ans).split()
                if len(raw_words) != target_count and len(exp_words) != target_count:
                    deductions.append(f"단어 수 조건 불일치: 총 {target_count}단어 조건이나 {len(raw_words)}단어로 작성됨 (-10점)")
                    score -= 10

        # 4. Type B(오류 수정)인 경우
        elif q_type == "typeB":
            correct_val = payload.get("correction", "").strip().lower()
            alt_corrections = payload.get("alternativeCorrections", [])
            symbol = payload.get("wrongSymbol", "").strip()
            user_symbol = payload.get("userSymbol", "").strip()
            
            norm_sym = normalize_symbol(symbol)
            norm_user_sym = normalize_symbol(user_symbol)
            
            if user_symbol and norm_sym != norm_user_sym and symbol not in user_symbol:
                deductions.append(f"틀린 부분 기호({symbol})를 잘못 선택했습니다 (-20점)")
                score -= 20
            
            # 올바른 형태 매칭 (축약형, 대체 답안 및 핵심 단어 검사)
            all_valid_corrections = [correct_val] + [str(a).strip().lower() for a in alt_corrections if a]
            std_lower = student_ans.lower().strip().rstrip(".!?")
            std_clean_str = " " + " ".join(clean_words(student_ans)) + " "
            
            matched = False
            for corr in all_valid_corrections:
                if not corr:
                    continue
                corr_clean = " ".join(clean_words(corr))
                if corr in std_lower or f" {corr_clean} " in std_clean_str or std_lower == corr:
                    matched = True
                    break
            
            if not matched:
                deductions.append(f"올바른 수정 형태 '{payload.get('correction')}'가 반영되지 않았습니다 (-30점)")
                score -= 30

        # 5. Type D(에세이)인 경우 분량 및 문장 수 검사
        elif q_type == "typeD":
            sentences = [s.strip() for s in re.split(r'[.!?]', student_ans) if len(s.strip()) > 3]
            words = student_ans.split()
            if len(sentences) < 3:
                deductions.append(f"에세이 분량 부족: 최소 3문장 이상 완결되어야 하나 {len(sentences)}문장만 작성됨 (-15점)")
                score -= 15
            if len(words) < 25:
                deductions.append(f"총 단어 수가 너무 부족합니다 ({len(words)}단어, 권장: 35~50단어) (-15점)")
                score -= 15

        # 점수 바운더리
        score = max(0, min(100, score))
        passed = (score >= 80)

        # 칭찬 및 피드백 멘트
        if score == 100:
            feedback = "🎉 완벽합니다! 감점 없는 완벽한 동도중학교 만점 답안입니다!"
        elif score >= 80:
            feedback = "👏 아주 잘했습니다! 몇 가지 사소한 규칙만 다듬으면 완벽해집니다."
        else:
            feedback = "💡 조금 더 보완이 필요해요. 감점 내역과 모범 답안을 확인하고 다시 도전해 보세요!"

        return {
            "score": score,
            "passed": passed,
            "deductions": deductions if deductions else ["감점 요인 없음 (만점)"],
            "praises": praises if praises else [],
            "sampleAnswer": sample_ans,
            "feedback": feedback
        }

def run_server(port=8000):
    server_address = ('', port)
    httpd = ThreadingHTTPServer(server_address, WritingAppHandler)
    httpd.daemon_threads = True
    print(f"=======================================================")
    print(f" [동도 롸이팅 마스터] 로컬 웹 서버가 성공적으로 시작되었습니다!")
    print(f" 브라우저 접속 주소: http://localhost:{port}")
    print(f" 중지하려면 터미널에서 Ctrl + C 를 누르세요.")
    print(f"=======================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
        httpd.server_close()

if __name__ == "__main__":
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    run_server(port)
