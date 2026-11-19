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

# ==========================================
# 창의 자유 영작 마스터 풀 (모든 교재 주제 소진 시 랜덤 제출)
# ==========================================
RANDOM_CREATIVE_TOPIC_POOL = [
    {
        "id": "creative_topic_future_school",
        "title": "My Dream Future School",
        "prompt": "10년 뒤 인공지능과 첨단 기술이 도입된 미래 학교의 모습을 4~5문장으로 상상하여 작성하시오.",
        "conditions": [
            "미래 시제(will 또는 be going to) 문장을 2개 이상 포함할 것",
            "학교 생활에서 가장 기대되는 변화(로봇 튜터, 홀로그램 수업 등)를 1가지 구체적으로 언급할 것",
            "총 분량: 35~50단어 내외"
        ],
        "sampleEssay": "In the future, our school will have friendly robot teachers. They will help each student learn at their own pace. Also, students will study science through amazing 3D holograms. School will be much more exciting and creative.",
        "rubricGuide": "미래 시제(will/be going to) 활용 30점, 창의적 세부 묘사 30점, 문장 연결 및 철자 40점"
    },
    {
        "id": "creative_topic_eco_lifestyle",
        "title": "Small Actions for Our Green Earth",
        "prompt": "지구 온난화와 기후 위기를 극복하기 위해 중학생으로서 매일 실천할 수 있는 친환경 약속을 4~5문장으로 작성하시오.",
        "conditions": [
            "조동사 should 또는 must가 포함된 문장을 2개 이상 작성할 것",
            "텀블러 사용, 분리배출, 대중교통 이용 등 일상적 실천 사항 2가지 제시할 것",
            "총 분량: 35~50단어 내외"
        ],
        "sampleEssay": "To protect our environment, we must take action in our daily lives. First, we should carry our own tumblers instead of disposable plastic cups. In addition, we should turn off lights when leaving the room. Small habits will save our planet.",
        "rubricGuide": "의무/권고 조동사(should, must) 30점, 실천 행동 구체성 30점, 접속사 및 어휘력 40점"
    },
    {
        "id": "creative_topic_smartphone_detox",
        "title": "A Day Without My Smartphone",
        "prompt": "스마트폰을 하루 동안 전혀 사용하지 않는다면 무엇을 하고 무엇을 느낄지 4~5문장으로 작성하시오.",
        "conditions": [
            "조건 접속사 if절 문장을 1개 이상 포함할 것",
            "스마트폰 대신 가족이나 친구와 함께 보낼 활동을 1가지 이상 서술할 것",
            "총 분량: 35~50단어 내외"
        ],
        "sampleEssay": "If I do not use my smartphone for a day, I will read interesting books. I can also ride a bicycle in the park with my best friends. We will talk face to face without looking at screens. It will be a peaceful and meaningful day.",
        "rubricGuide": "조건문 if절 시제 일치 30점, 활동 표현의 구체성 30점, 문맥 흐름 및 어법 40점"
    },
    {
        "id": "creative_topic_daegu_tour",
        "title": "Welcome to Daegu: A Special Guide",
        "prompt": "대구를 처음 방문한 외국인 친구에게 소개하고 싶은 명소와 음식을 4~5문장으로 추천하는 글을 작성하시오.",
        "conditions": [
            "최상급(the most...) 또는 비교급 표현을 1개 이상 포함할 것",
            "수성못(Suseong Lake), 동성로, 앞산 등 구체적 장소 1곳과 추천 음식을 포함할 것",
            "총 분량: 35~50단어 내외"
        ],
        "sampleEssay": "Welcome to Daegu, the most energetic city in Korea! You should definitely visit Suseong Lake in the evening because the night view is splendid. Also, you must try delicious Daegu-style noodles. You will make unforgettable memories here.",
        "rubricGuide": "최상급/비교급 어법 30점, 추천 명소 및 이유 전개 30점, 어휘 다양성 40점"
    },
    {
        "id": "creative_topic_role_model",
        "title": "The Person I Admire Most",
        "prompt": "자신이 가장 존경하는 인물(가족, 위인, 멘토 등)과 그를 존경하는 이유를 4~5문장으로 작성하시오.",
        "conditions": [
            "이유를 나타내는 접속사 because 또는 as 문장을 2개 이상 포함할 것",
            "해당 인물의 성품이나 업적을 묘사하는 형용사(diligent, caring, brave 등)를 2개 이상 사용할 것",
            "총 분량: 35~50단어 내외"
        ],
        "sampleEssay": "The person I admire most is my mother. She is always diligent and warm-hearted. I respect her because she always listens to my worries patiently. Thanks to her love, I can face difficult challenges with confidence.",
        "rubricGuide": "이유 접속사(because) 구문력 30점, 인물 묘사 형용사 30점, 문장 완성도 40점"
    },
    {
        "id": "creative_topic_secret_hobby",
        "title": "My Favorite Way to Relieve Stress",
        "prompt": "시험이나 공부로 쌓인 스트레스를 해소하는 나만의 취미 활동을 4~5문장으로 소개하시오.",
        "conditions": [
            "동명사(-ing) 또는 to부정사를 주어나 목적어로 1개 이상 활용할 것",
            "스트레스 해소 후 기분이나 효과를 나타내는 표현을 포함할 것",
            "총 분량: 35~50단어 내외"
        ],
        "sampleEssay": "Listening to energetic music is my favorite way to relieve stress. When I put on my headphones, all my worries disappear. I also enjoy drawing cartoons in my room. These hobbies refresh my mind and give me new energy.",
        "rubricGuide": "동명사/to부정사 활용 30점, 심경 및 변화 서술 30점, 자연스러운 흐름 40점"
    }
]

def select_free_writing_topic(user_id, textbook_id, exclude_topic_id=None):
    completed_topics = set()
    user_dir = os.path.join(USERS_DIR, user_id)
    if os.path.exists(user_dir):
        essays = load_json(os.path.join(user_dir, "essays.json"), [])
        for e in essays:
            if e.get("topic"):
                completed_topics.add(e["topic"].strip())
            if e.get("topicId"):
                completed_topics.add(e["topicId"].strip())

    if exclude_topic_id:
        completed_topics.add(exclude_topic_id.strip())

    # 1단계: 현재 선택된 교재 단원들의 typeD 주제 중 미완료 주제 우선 탐색
    cur_tb_path = os.path.join(CURRICULUM_DIR, f"{textbook_id}.json")
    if os.path.exists(cur_tb_path):
        cur_tb = load_json(cur_tb_path, {})
        for u in cur_tb.get("units", []):
            for t in u.get("typeD", []):
                t_id = t.get("id", "").strip()
                t_title = t.get("title", "").strip()
                if t_id not in completed_topics and t_title not in completed_topics:
                    diff_str = f" [{cur_tb.get('difficultyIcon','')} {cur_tb.get('difficultyLabel','')}]" if cur_tb.get('difficultyLabel') else ""
                    return {
                        "topic": t,
                        "sourceType": "current_textbook",
                        "sourceBadge": f"🏫 현재 교재 맞춤{diff_str} ({cur_tb.get('title', '선택 교재')})",
                        "unitTitle": u.get("title", "")
                    }

    # 2단계: 현재 교재의 주제를 모두 풀었을 경우, 다른 교재(11종 라이브러리)에서 미완료 주제 순환 발굴
    catalog_path = os.path.join(CURRICULUM_DIR, "catalog.json")
    catalog_list = load_json(catalog_path, [])
    for cat_item in catalog_list:
        other_id = cat_item.get("id")
        if other_id == textbook_id:
            continue
        other_path = os.path.join(CURRICULUM_DIR, f"{other_id}.json")
        if os.path.exists(other_path):
            other_tb = load_json(other_path, {})
            for u in other_tb.get("units", []):
                for t in u.get("typeD", []):
                    t_id = t.get("id", "").strip()
                    t_title = t.get("title", "").strip()
                    if t_id not in completed_topics and t_title not in completed_topics:
                        diff_str = f" [{other_tb.get('difficultyIcon','')} {other_tb.get('difficultyLabel','')}]" if other_tb.get('difficultyLabel') else ""
                        return {
                            "topic": t,
                            "sourceType": "other_textbook",
                            "sourceBadge": f"🔄 타 교재 순환 추천{diff_str} ({other_tb.get('title', other_id)})",
                            "unitTitle": u.get("title", "")
                        }

    # 3단계: 모든 교재의 주제를 100% 완료한 경우, 창의 자유 영작 마스터 풀에서 미완료 또는 랜덤 출제
    available_pool = [
        t for t in RANDOM_CREATIVE_TOPIC_POOL 
        if t["id"] not in completed_topics and t["title"] not in completed_topics
    ]
    if not available_pool:
        available_pool = RANDOM_CREATIVE_TOPIC_POOL

    import random
    picked = random.choice(available_pool)
    return {
        "topic": picked,
        "sourceType": "random_pool",
        "sourceBadge": "🎲 창의 자유 영작 마스터 풀 (랜덤 출제)",
        "unitTitle": "전국 상위권 서술형 창의 작문"
    }

def evaluate_free_writing(payload):
    student_text = str(payload.get("studentText", "")).strip()
    topic = payload.get("topic", {})
    topic_title = topic.get("title", "자유 영작 주제")
    prompt = topic.get("prompt", "")
    conditions = topic.get("conditions", [])
    sample_essay = topic.get("sampleEssay", "")

    if not student_text:
        return {
            "score": 0,
            "passed": False,
            "rubricScores": {
                "relevance": 0,
                "structure": 0,
                "grammar": 0,
                "vocabulary": 0
            },
            "feedback": "작성된 에세이가 없습니다. 문장을 작성해 주세요!",
            "corrections": [],
            "lexicalUpgrades": [],
            "sentenceCombineTip": None,
            "modelRewrite": sample_essay,
            "praises": []
        }

    raw_sentences = [s.strip() for s in re.split(r'[.!?]+', student_text) if len(s.strip()) > 1]
    raw_words = re.findall(r"[A-Za-z0-9'\-]+", student_text)
    word_count = len(raw_words)
    sentence_count = len(raw_sentences)

    # 1. Rubric: Task Achievement & Relevance (25점 만점)
    rel_score = 25
    rel_deductions = []
    
    if word_count < 25:
        rel_deductions.append(f"총 단어 수 부족 ({word_count}단어 작성, 권장: 35~50단어)")
        rel_score -= min(12, (25 - word_count) // 2)
    elif word_count > 90:
        rel_deductions.append(f"분량 다소 초과 ({word_count}단어 작성, 35~60단어 권장)")
        rel_score -= 2

    if sentence_count < 3:
        rel_deductions.append(f"문장 수 부족 ({sentence_count}문장 작성, 최소 3~5문장 필요)")
        rel_score -= 6
    
    # Topic keyword alignment check
    prompt_keywords = set([w.lower() for w in re.findall(r"[A-Za-z]{3,}", prompt + " " + topic_title)])
    std_words_lower = set([w.lower() for w in raw_words])
    overlap = prompt_keywords.intersection(std_words_lower)
    if prompt_keywords and len(overlap) == 0 and len(raw_words) > 10:
        rel_score -= 3
        rel_deductions.append("주제 관련 핵심 키워드 활용이 다소 아쉽습니다.")

    rel_score = max(5, min(25, rel_score))

    # 2. Rubric: Sentence Structure & Complexity (25점 만점)
    struct_score = 25
    struct_deductions = []
    connectors_found = []
    KEY_CONNECTORS = [
        "and", "but", "so", "because", "although", "while", "if", "when", 
        "after", "before", "since", "which", "who", "that", "first", "also", 
        "in addition", "therefore", "however", "finally", "instead"
    ]
    lower_text = student_text.lower()
    for conn in KEY_CONNECTORS:
        if f" {conn} " in f" {lower_text} ":
            connectors_found.append(conn)

    if len(connectors_found) == 0:
        struct_score -= 6
        struct_deductions.append("문장 연결어(접속사)가 없어 문장 간 호흡이 다소 단절되어 보입니다.")
    elif len(connectors_found) >= 2:
        struct_score = 25
    else:
        struct_score -= 2

    if raw_sentences:
        lengths = [len(s.split()) for s in raw_sentences]
        if max(lengths) - min(lengths) < 2 and len(raw_sentences) >= 3:
            struct_score -= 2
            struct_deductions.append("문장의 길이가 모두 비슷합니다. 긴 문장과 짧은 문장을 섞어 리듬감을 살려보세요.")

    struct_score = max(5, min(25, struct_score))

    # 3. Rubric: Grammar & Mechanical Accuracy (25점 만점)
    gram_score = 25
    corrections = []

    # Mechanics: Capitalization at start of each sentence
    for idx, s in enumerate(raw_sentences):
        if s and not s[0].isupper():
            corrections.append({
                "original": s[:20] + "...",
                "corrected": s[0].upper() + s[1:20] + "...",
                "reason": "영어 문장의 첫 글자는 반드시 대문자로 시작해야 합니다."
            })
            gram_score -= 3

    # Mechanics: Punctuation at end
    if not student_text.strip().endswith(('.', '!', '?')):
        corrections.append({
            "original": student_text[-20:],
            "corrected": student_text[-20:] + ".",
            "reason": "문장의 끝에는 마침표(.)나 느낌표(!) 등 문장 부호를 빠뜨리지 않아야 합니다."
        })
        gram_score -= 3

    # Subject-verb agreement (3rd person singular present)
    SINGULAR_SUBJECTS = ["he", "she", "it", "my friend", "my brother", "my sister", "my mother", "my father", "my teacher", "everyone", "everybody"]
    BASE_VERBS_MAP = {
        "like": "likes", "want": "wants", "play": "plays", "go": "goes", "have": "has",
        "study": "studies", "watch": "watches", "read": "reads", "live": "lives",
        "make": "makes", "need": "needs", "help": "helps", "eat": "eats", "run": "runs"
    }
    for subj in SINGULAR_SUBJECTS:
        for base, inflected in BASE_VERBS_MAP.items():
            pattern = rf"\b{subj}\s+{base}\b"
            if re.search(pattern, lower_text):
                corrections.append({
                    "original": f"{subj} {base}",
                    "corrected": f"{subj} {inflected}",
                    "reason": f"주어({subj})가 3인칭 단수이므로 동사 원형 '{base}' 대신 -s/es를 붙인 '{inflected}'를 써야 합니다."
                })
                gram_score -= 4

    # Be-verb agreement
    BE_MISTAKES = [
        (r"\bi\s+is\b", "I is", "I am", "1인칭 주어 I의 be동사는 am입니다."),
        (r"\bthey\s+was\b", "they was", "they were", "복수 주어 they의 과거 be동사는 were입니다."),
        (r"\bwe\s+is\b", "we is", "we are", "복수 주어 we의 be동사는 are입니다."),
        (r"\byou\s+is\b", "you is", "you are", "2인칭 주어 you의 be동사는 are입니다."),
        (r"\bhe\s+are\b", "he are", "he is", "3인칭 단수 주어 he의 be동사는 is입니다."),
        (r"\bshe\s+are\b", "she are", "she is", "3인칭 단수 주어 she의 be동사는 is입니다.")
    ]
    for pat, orig, corr, rsn in BE_MISTAKES:
        if re.search(pat, lower_text):
            corrections.append({
                "original": orig,
                "corrected": corr,
                "reason": rsn
            })
            gram_score -= 4

    # Double verbs without to/ing
    DOUBLE_VERB_PATTERNS = [
        (r"\blike\s+play\b", "like play", "like playing (또는 like to play)", "like 뒤에는 동명사(-ing)나 to부정사가 와야 합니다."),
        (r"\benjoy\s+to\b", "enjoy to", "enjoy -ing", "enjoy 뒤에는 to부정사가 아닌 동명사(-ing)를 목적어로 씁니다."),
        (r"\bwant\s+playing\b", "want playing", "want to play", "want 뒤에는 동명사 대신 to부정사를 씁니다.")
    ]
    for pat, orig, corr, rsn in DOUBLE_VERB_PATTERNS:
        if re.search(pat, lower_text):
            corrections.append({
                "original": orig,
                "corrected": corr,
                "reason": rsn
            })
            gram_score -= 3

    # Common prepositions
    PREP_MISTAKES = [
        (r"\blisten\s+music\b", "listen music", "listen to music", "listen은 자동사이므로 음악을 들을 때 전치사 to가 반드시 필요합니다."),
        (r"\barrive\s+to\b", "arrive to", "arrive at (또는 arrive in)", "도착하다는 arrive at(장소) 또는 arrive in(도시/국가)을 씁니다."),
        (r"\bgraduate\s+school\b", "graduate school", "graduate from school", "학교를 졸업하다는 전치사 from을 함께 씁니다.")
    ]
    for pat, orig, corr, rsn in PREP_MISTAKES:
        if re.search(pat, lower_text):
            corrections.append({
                "original": orig,
                "corrected": corr,
                "reason": rsn
            })
            gram_score -= 3

    gram_score = max(5, min(25, gram_score))

    # 4. Rubric: Vocabulary Variety & Appropriateness (25점 만점)
    vocab_score = 25
    unique_words = set([w.lower() for w in raw_words])
    unique_ratio = len(unique_words) / max(1, word_count)
    if unique_ratio < 0.55 and word_count > 25:
        vocab_score -= 3
    elif unique_ratio > 0.70:
        vocab_score = 25

    vocab_score = max(5, min(25, vocab_score))

    total_score = rel_score + struct_score + gram_score + vocab_score
    passed = total_score >= 80

    # 5. 작문 스킬 향상: 고급 어휘 1:1 추천 (Lexical Upgrades)
    UPGRADE_DICT = {
        "good": {
            "alternatives": ["beneficial (유익한)", "splendid (훌륭한)", "favorable (호의적인)"],
            "tip": "'good' 대신 'beneficial'이나 'splendid'를 쓰면 문장의 품격이 한 단계 상승합니다."
        },
        "bad": {
            "alternatives": ["harmful (해로운)", "unfavorable (불리한)", "challenging (힘든)"],
            "tip": "'bad' 대신 'harmful' 또는 'unfavorable'을 사용해 보세요."
        },
        "happy": {
            "alternatives": ["delighted (매우 기쁜)", "thrilled (짜릿하게 신난)", "pleased (만족스러운)"],
            "tip": "'happy' 대신 'delighted'를 활용하면 감정 표현이 훨씬 생생해집니다."
        },
        "very": {
            "alternatives": ["extremely (극도로)", "remarkably (현저히)", "greatly (대단히)"],
            "tip": "'very'를 반복하기보다 'extremely'나 'remarkably'를 배치하면 강조 효과가 배가됩니다."
        },
        "think": {
            "alternatives": ["believe that (~라고 확신하다)", "in my perspective (내 관점에서는)", "consider (~로 여기다)"],
            "tip": "'I think' 대신 'I believe that' 또는 'From my perspective'로 도입하면 수성구 상위권 에세이 느낌을 줍니다."
        },
        "like": {
            "alternatives": ["am fond of (~을 무척 좋아하다)", "prefer (~을 선호하다)", "admire (동경하다)"],
            "tip": "'like' 대신 'be fond of'나 'prefer'를 쓰면 다양한 어휘 구사력 가산점을 받습니다."
        },
        "important": {
            "alternatives": ["crucial (중대한)", "essential (필수적인)", "significant (유의미한)"],
            "tip": "'important' 대신 'crucial'이나 'essential'을 활용하면 핵심 논지가 강력해집니다."
        },
        "help": {
            "alternatives": ["assist (지원하다)", "contribute to (~에 기여하다)"],
            "tip": "'help' 대신 'assist'나 'contribute to'를 활용해 보세요."
        },
        "many": {
            "alternatives": ["numerous (수많은)", "a variety of (다양한)", "a wide range of (폭넓은)"],
            "tip": "'many' 대신 'numerous'나 'a variety of'를 쓰면 문장이 훨씬 풍성해집니다."
        },
        "interesting": {
            "alternatives": ["fascinating (매혹적인)", "engaging (몰입감을 주는)"],
            "tip": "'interesting' 대신 'fascinating'이나 'engaging'을 활용해 보세요."
        }
    }

    lexical_upgrades = []
    found_upgrade_keys = set()
    for w in raw_words:
        w_low = w.lower()
        if w_low in UPGRADE_DICT and w_low not in found_upgrade_keys:
            found_upgrade_keys.add(w_low)
            lexical_upgrades.append({
                "original": w_low,
                "alternatives": UPGRADE_DICT[w_low]["alternatives"],
                "tip": UPGRADE_DICT[w_low]["tip"]
            })
            if len(lexical_upgrades) >= 3:
                break

    if not lexical_upgrades:
        lexical_upgrades.append({
            "original": "like / enjoy",
            "alternatives": ["be fond of (~을 애호하다)", "prefer (~을 선호하다)"],
            "tip": "선호나 취향을 나타낼 때 'be fond of'나 'prefer'를 곁들이면 표현력이 다채로워집니다."
        })
        lexical_upgrades.append({
            "original": "very / really",
            "alternatives": ["extremely (극도로)", "remarkably (눈에 띄게)"],
            "tip": "강조 부사로 'extremely'나 'remarkably'를 활용하면 어조의 설득력이 강해집니다."
        })

    # 6. 문장 결합 및 복문 변형 예시 (Sentence Combining Pro-Tip)
    sentence_combine_tip = None
    if len(raw_sentences) >= 2:
        s1 = raw_sentences[0].rstrip(".!?")
        s2 = raw_sentences[1].rstrip(".!?")
        sentence_combine_tip = {
            "originalPair": [raw_sentences[0], raw_sentences[1]],
            "proTip": "두 개의 짧은 단문을 관계대명사(who/which) 또는 이유/조건 접속사(Because/Although)를 활용해 하나의 복문으로 합치면 감점 없는 고득점 에세이가 완성됩니다.",
            "example": f"💡 복문 업그레이드 예시: {s1}, which helps {s2.lower()}."
        }
    else:
        sentence_combine_tip = {
            "originalPair": ["I have a hobby. It is reading books."],
            "proTip": "단문을 연속으로 쓰기보다 관계대명사나 종속접속사(Because, When, Although)로 결합해 보세요.",
            "example": "💡 복문 업그레이드 예시: My favorite hobby is reading books, which expands my imagination."
        }

    # Praises
    praises = []
    if total_score >= 90:
        praises.append("🌟 동도중 내신 1등급 수준의 완벽한 문장력과 논리 전개입니다!")
    if len(connectors_found) >= 2:
        praises.append(f"🔗 접속사({', '.join(connectors_found[:3])})를 효과적으로 배치하여 글의 결속성이 뛰어납니다.")
    if word_count >= 35 and word_count <= 60:
        praises.append(f"📏 수행평가 루브릭 권장 분량({word_count}단어)을 매우 정확하게 준수했습니다.")
    if len(unique_words) / max(1, word_count) > 0.65:
        praises.append("🎨 다양한 어휘를 골고루 구사하여 단어 반복이 적고 표현이 풍성합니다.")

    # General feedback
    if total_score >= 95:
        feedback = "🏆 완벽에 가까운 명문입니다! 주제와 문맥, 어법과 어휘까지 완벽하게 소화했습니다."
    elif total_score >= 85:
        feedback = "👏 매우 우수한 에세이입니다! 아래 추천 어휘와 문장 결합 팁을 적용하면 100점 만점에 도달합니다."
    elif total_score >= 70:
        feedback = "💡 좋은 아이디어가 잘 드러난 글입니다. 지적된 문법 교정 사항을 확인하고 더 세련된 어휘로 다듬어 보세요!"
    else:
        feedback = "🌱 첫걸음으로 훌륭합니다. 안내된 모범 에세이와 교정 노트를 참고하여 한 번 더 연습해 보세요!"

    return {
        "score": total_score,
        "passed": passed,
        "rubricScores": {
            "relevance": rel_score,
            "structure": struct_score,
            "grammar": gram_score,
            "vocabulary": vocab_score
        },
        "feedback": feedback,
        "relDeductions": rel_deductions,
        "structDeductions": struct_deductions,
        "corrections": corrections,
        "lexicalUpgrades": lexical_upgrades,
        "sentenceCombineTip": sentence_combine_tip,
        "modelRewrite": sample_essay or (student_text + " (Well-written)"),
        "praises": praises,
        "wordCount": word_count,
        "sentenceCount": sentence_count
    }

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
                "textbookId": tb_id,
                "textbookTitle": tb_data.get("title", "YBM(박준언) 중1"),
                "difficultyRank": tb_data.get("difficultyRank", 10),
                "difficultyTier": tb_data.get("difficultyTier", "중하"),
                "difficultyLabel": tb_data.get("difficultyLabel", "11권 중 10위 (중하)"),
                "difficultyIcon": tb_data.get("difficultyIcon", "🌱"),
                "difficultyGauge": tb_data.get("difficultyGauge", "●●○○○"),
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

        elif path == "/api/free_writing_topic":
            user_id = query.get("userId", ["minho"])[0]
            tb_id = query.get("textbookId", ["ybm_park_grade1"])[0]
            exclude_id = query.get("excludeTopicId", [""])[0]
            topic_info = select_free_writing_topic(user_id, tb_id, exclude_id)
            self.send_json(topic_info)

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
                    "topicId": essay_item.get("topicId", ""),
                    "sourceBadge": essay_item.get("sourceBadge", ""),
                    "createdAt": today_str,
                    "score": essay_item.get("score", 95),
                    "rubricScores": essay_item.get("rubricScores", {}),
                    "studentText": essay_item.get("studentText", ""),
                    "feedback": essay_item.get("feedback", "조건을 모두 충족한 훌륭한 작문입니다."),
                    "lexicalUpgrades": essay_item.get("lexicalUpgrades", []),
                    "modelRewrite": essay_item.get("modelRewrite", "")
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

        elif path == "/api/evaluate_free_writing":
            result = evaluate_free_writing(payload)
            self.send_json(result)

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
