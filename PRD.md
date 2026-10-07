# PRD: 냉장고 재료 인식 & 레시피 추천 웹앱

## 1. 개요

냉장고 사진을 올리면 AI가 재료를 인식하고, 사용자가 재료를 빼거나 더한 뒤, 그 재료로 만들 수 있는 레시피 3개를 추천받아 이름만 있는 프로필에 저장하고 다시 볼 수 있는 웹앱.

- 형태: `index.html` 파일 1개 (HTML + CSS + JS 인라인, npm/빌드 없음)
- AI 모델: OpenRouter의 `google/gemma-4-31b-it:free` (1·2단계 모두)
- 백엔드: Supabase (Edge Function 2개 + Postgres 테이블 2개)
- 대상: 개인 학습/데모용. 한국어 UI, 한국어 응답.

## 2. 반드시 지킬 제약

| 항목 | 내용 |
|---|---|
| API 키 | `OPENROUTER_API_KEY`는 Supabase Secrets에 이미 있음. `Deno.env.get("OPENROUTER_API_KEY")`로만 읽고, `index.html`·함수 코드·문서 어디에도 값을 쓰지 않는다. |
| AI 호출 | 브라우저는 OpenRouter를 직접 호출하지 않는다. Edge Function 2개만 호출한다. |
| JWT | 두 함수 모두 `verify_jwt = false`. (`supabase/config.toml`의 `[functions.<이름>] verify_jwt = false` 또는 배포 시 `--no-verify-jwt`) |
| 구성 | 단일 `index.html`. 라이브러리는 CDN `<script>`만 허용 (supabase-js를 쓸 경우 jsdelivr ESM). npm·번들러 금지. |
| 공개 가능한 값 | Supabase Project URL과 anon(publishable) 키는 `index.html`에 넣어도 된다. service_role 키는 절대 넣지 않는다. |

## 3. 정해지지 않아 내가 정한 것들

| 결정 | 선택 | 이유 |
|---|---|---|
| 함수 이름 | `detect-ingredients`, `generate-recipes` | 역할이 이름에 드러남 |
| 이미지 전달 | 브라우저에서 긴 변 1024px로 줄인 JPEG(품질 0.8)를 base64 data URL로 JSON에 담아 전송 | 무료 모델·함수 요청 크기 제한 회피, multipart 파싱 불필요 |
| 이미지 저장 | 저장하지 않음 (인식 후 버림) | 스토리지 불필요, 개인정보 부담 감소 |
| 응답 형식 | 프롬프트로 "JSON만 출력" 강제 + 함수에서 코드펜스 제거 후 파싱, 실패 시 1회 재시도 | 무료 모델은 `response_format`을 보장하지 않음 |
| 재료 단위 | 이름 문자열 배열 (수량 없음) | 사진으로 수량 추정은 부정확 |
| 프로필 | 이름 입력 → 같은 이름이 있으면 그 프로필로 "로그인", 없으면 생성. 이름은 1~20자, 중복 불가(대소문자·공백 정리 후) | "이름만" 요구사항 |
| 프로필 유지 | `localStorage`에 `profile_id`, `profile_name` 저장 | 새로고침해도 유지 |
| 인증 | 없음. 이름을 아는 사람은 누구나 그 프로필의 레시피를 볼 수 있음 | 요구사항상 이름만 사용. 한계로 명시 (8장) |
| DB 접근 | 3단계는 브라우저가 anon 키로 PostgREST 직접 호출 (세 번째 함수를 만들지 않음) | "AI 함수는 2개" 요구 유지, 구조 단순화 |
| RLS | 활성화 + anon에게 select/insert/delete 허용, update 불허 | RLS 끄는 것보다 안전한 최소 권한 |
| 저장 단위 | 레시피 1개당 1행 | 3개 중 마음에 드는 것만 저장 가능 |
| 언어 | UI·프롬프트·응답 모두 한국어 | |
| 디자인 | 모바일 우선 단일 컬럼, 시스템 폰트, 라이트/다크 자동(`prefers-color-scheme`) | |

## 4. 사용자 흐름

```
[프로필 입력] → [사진 업로드] → [재료 인식 중...] → [재료 칩 편집] → [레시피 3개 생성] → [저장] → [내 레시피 목록]
```

프로필은 3단계 기능이지만 화면 상단에 항상 보인다. 프로필 없이도 1·2단계는 쓸 수 있고, 저장 버튼을 누를 때 프로필이 없으면 이름 입력을 요구한다.

## 5. 단계별 요구사항

### 1단계 — 사진 → 재료 인식 (+ 편집)

**기능**
1. 사진 선택: `<input type="file" accept="image/*">` (모바일은 카메라 촬영도 가능), 드래그 앤 드롭 지원.
2. 선택 즉시 미리보기 표시, 캔버스로 리사이즈·JPEG 압축.
3. "재료 인식" 버튼 → `detect-ingredients` 호출 → 로딩 표시.
4. 결과를 **칩(chip) 목록**으로 표시.
   - 칩의 ✕ 버튼으로 **삭제**
   - 입력창 + Enter/추가 버튼으로 **추가** (중복·빈 값·공백만 있는 값 거부, 최대 40개)
5. 재료가 0개가 되면 다음 단계 버튼 비활성화.
6. 사진을 다시 고르면 재료 목록을 초기화한다(확인 없이 덮어쓰기, 단 직접 편집한 내용이 있으면 `confirm`으로 물어봄).

**Edge Function `detect-ingredients`**
- 요청: `POST { "image": "data:image/jpeg;base64,..." }`
- 처리: 입력 검증(data URL 형식, 약 4MB 초과 시 413) → OpenRouter `POST https://openrouter.ai/api/v1/chat/completions`, 모델 `google/gemma-4-31b-it:free`, 메시지에 `image_url` 파트 포함, `temperature: 0.2`.
- 프롬프트 요지: "냉장고/식재료 사진에서 눈에 보이는 식재료만 한국어 일반 명사로 나열. 브랜드명·용기·조미료 병 이름 제외 가능, 추측 금지. `{"ingredients":["..."]}` JSON만 출력."
- 응답: `200 { "ingredients": ["계란", "우유", ...] }` — 공백 제거·중복 제거·최대 40개로 정규화.
- 에러: `400`(잘못된 입력), `413`, `429`(무료 한도), `502`(모델 오류/파싱 실패) — 모두 `{ "error": "사용자에게 보여줄 한국어 메시지" }`.

**수락 기준**
- 재료가 보이는 사진 → 10초 안팎(무료 모델 대기 제외)으로 칩 목록 표시
- 재료가 없는 사진 → "재료를 찾지 못했어요. 직접 추가해 주세요" 안내, 빈 상태에서도 수동 추가 가능
- 재료 추가/삭제가 즉시 화면에 반영

### 2단계 — 재료 → 레시피 3개

**기능**
1. "레시피 추천받기" 버튼 → `generate-recipes`에 현재 재료 배열 전송.
2. 결과 카드 정확히 3개 표시: 제목, 한 줄 설명, 조리시간(분), 난이도(쉬움/보통/어려움), 재료 목록(보유/추가 필요 구분), 조리 순서.
3. 재료를 수정한 뒤 다시 누르면 새로 생성(이전 결과 교체).
4. 각 카드에 "저장" 버튼 (3단계에서 활성화).

**Edge Function `generate-recipes`**
- 요청: `POST { "ingredients": ["계란", "우유", ...] }` (1~40개, 각 항목 1~30자)
- 처리: 같은 모델 호출, `temperature: 0.7`.
- 프롬프트 요지: "주어진 재료를 최대한 활용한 서로 다른 한국어 레시피 정확히 3개. 기본 양념(소금, 설탕, 간장, 식용유, 후추, 물)은 있다고 가정. 재료에 없는 것은 `have:false`. JSON만 출력."
- 응답 스키마:
```json
{
  "recipes": [
    {
      "title": "string",
      "summary": "string",
      "cook_time_min": 15,
      "difficulty": "쉬움|보통|어려움",
      "ingredients": [{ "name": "계란", "amount": "2개", "have": true }],
      "steps": ["string", "..."]
    }
  ]
}
```
- 검증: 함수에서 스키마를 확인하고, 3개가 아니면 1회 재시도 후에도 실패하면 `502`. 3개 초과 시 앞 3개만 사용.
- 에러 형식은 1단계와 동일.

**수락 기준**
- 항상 3개 카드가 표시되거나, 실패 시 한국어 에러 + "다시 시도" 버튼
- 입력 재료에 있는 것은 `have:true`로 표시되고 시각적으로 구분

### 3단계 — 프로필 + Supabase 저장/조회

**기능**
1. 프로필: 이름만 입력(1~20자). 이름을 정리(trim, 연속 공백 1칸)한 뒤 `profiles`에서 조회, 없으면 insert.
2. 레시피 카드의 "저장" → `recipes`에 insert (현재 프로필 연결). 저장 후 버튼은 "저장됨"으로 바뀌고 중복 저장 방지.
3. "내 레시피" 탭/섹션: 현재 프로필의 저장 레시피를 최신순으로 목록 표시, 클릭하면 상세(2단계 카드와 동일한 레이아웃) 펼침.
4. 저장된 레시피 삭제 버튼 (확인 후 삭제).
5. 프로필 전환/로그아웃: 이름 옆 "변경" 버튼 → `localStorage` 비움.

**데이터 모델**
```sql
create table profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 20),
  created_at timestamptz not null default now()
);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  summary text,
  cook_time_min int,
  difficulty text,
  ingredients jsonb not null,   -- [{name, amount, have}]
  steps jsonb not null,         -- ["...", ...]
  created_at timestamptz not null default now()
);
create index on recipes (profile_id, created_at desc);
```

**RLS**: 두 테이블 모두 `enable row level security`. `anon` 역할에 `select`, `insert`(두 테이블), `delete`(recipes만) 정책 부여. `update`와 `profiles` delete는 정책 없음 = 불가.

**수락 기준**
- 저장 → 새로고침 → 같은 이름으로 들어와도 레시피가 그대로 보임
- 다른 이름으로 들어오면 그 사람의 레시피만 보임(필터링은 `profile_id`)
- 삭제하면 목록과 DB에서 사라짐

## 6. 화면 구성 (단일 페이지)

1. 헤더: 앱 이름 · 프로필(이름 / 변경)
2. 섹션 ① 사진 · 재료
3. 섹션 ② 레시피 추천
4. 섹션 ③ 내 레시피 (저장 목록)

섹션은 위에서 아래로 이어지며, 이전 단계가 끝나야 다음 단계 버튼이 활성화된다. 비동기 작업 중에는 해당 버튼을 비활성화하고 스피너를 표시한다.

## 7. 비기능 요구사항

- **보안**: 코드·저장소에 OpenRouter 키 없음. 함수는 사용자 입력을 길이·형식 검증. 화면 출력은 `textContent`/이스케이프로 처리해 AI 응답에 의한 XSS 방지. 함수 CORS는 `*` 허용(`OPTIONS` 처리 포함).
- **성능**: 이미지 1024px 리사이즈로 전송량 축소. 함수 클라이언트 타임아웃 60초.
- **오류 처리**: 모든 호출 실패 시 한국어 메시지 + 재시도 가능. 네트워크 단절·429·모델 응답 파싱 실패를 구분해 안내.
- **접근성**: 버튼 `aria-label`, 키보드로 재료 추가 가능, 대비 충분한 색상.
- **지원 브라우저**: 최신 Chrome/Safari/Edge, 모바일 포함.

## 8. 알려진 한계와 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| 무료 모델 레이트 리밋 (OpenRouter 무료 모델은 분당·일일 호출 수 제한) | 429 발생 | 한국어 안내 + 잠시 후 재시도 버튼. 필요하면 나중에 유료 모델로 모델명만 교체 |
| 무료 모델은 가용성/응답 품질이 일정하지 않음 | 재료 오인식, JSON 깨짐 | 사용자가 재료를 편집할 수 있게 한 것이 핵심 안전장치, JSON 재시도 1회 |
| 모델명 `google/gemma-4-31b-it:free`의 이미지 입력 지원·ID 유효성 | 구현 시 404/400 | STEPS.md 0단계에서 curl로 먼저 확인. 이미지 미지원이면 사용자에게 알리고 결정 요청 |
| 인증 없는 프로필 | 이름만 알면 타인 레시피 열람·삭제 가능 | 데모 용도로 수용. 민감 정보는 저장하지 않음. 필요 시 후속으로 Supabase Auth 도입 |
| 함수 `verify_jwt=false` | 누구나 함수 URL 호출 가능, 키 사용량 소모 | 입력 크기·개수 제한, 필요 시 후속으로 IP 기반 제한/간단한 공유 토큰 추가 |
| anon 키 노출 | 정상 (공개 키) | RLS로 권한 제한 |

## 9. 범위 밖 (이번에 하지 않는 것)

- 이미지 저장, 재료 수량/유통기한 관리
- 이메일·소셜 로그인, 비밀번호
- 레시피 수정, 즐겨찾기, 공유
- 다국어, PWA/오프라인
- 자동화 테스트 코드 (수동 검증 체크리스트로 대체)

## 10. 완료 정의

- STEPS.md의 모든 단계 검증 항목 통과
- 저장소 전체 검색에서 OpenRouter 키 형태 문자열(`sk-or-`)이 0건
- 두 함수가 `verify_jwt=false`로 배포되어 있고 인증 헤더 없이 호출 가능
- 사진 업로드 → 재료 편집 → 레시피 3개 → 저장 → 새로고침 후 재조회가 한 번에 동작
