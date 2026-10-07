# STEPS: 구현 순서

PRD.md를 기준으로 한 작업 순서. 각 단계 끝의 **검증**을 통과한 뒤 다음으로 넘어간다.
`<PROJECT_REF>`는 Supabase 프로젝트 ref, `<ANON_KEY>`는 anon(publishable) 키.

## 파일 구조

```
day07-2/
├── index.html                              # 앱 전체 (HTML+CSS+JS)
├── PRD.md
├── STEPS.md
└── supabase/
    ├── config.toml                         # verify_jwt = false 설정
    ├── migrations/001_init.sql             # 테이블 + RLS
    └── functions/
        ├── detect-ingredients/index.ts
        └── generate-recipes/index.ts
```

---

## 0단계. 준비 · 사전 확인

- [ ] Supabase 프로젝트 확인: Project URL, anon 키 확보 (Dashboard → Project Settings → API)
- [ ] Secrets에 `OPENROUTER_API_KEY`가 있는지 확인 (Dashboard → Edge Functions → Secrets). 값은 열어보거나 출력하지 않는다.
- [ ] Supabase CLI 설치·로그인·`supabase link --project-ref <PROJECT_REF>` (또는 MCP로 배포)
- [ ] 모델 확인: 이미지 입력이 되는지 한 번 호출해 본다. 키는 쉘 환경변수로만 쓰고 파일/히스토리에 남기지 않는다.
  ```bash
  curl -s https://openrouter.ai/api/v1/models | grep -o '"google/gemma-4-31b-it:free"'
  ```
  모델 ID가 없거나 이미지 입력 미지원이면 **여기서 멈추고** 사용자에게 알린다(대체 모델은 임의로 정하지 않음).

**검증**: 모델 ID 존재 확인, Secret 이름 확인 완료.

---

## 1단계. 사진 → 재료 인식

### 1-1. 함수 `detect-ingredients`
`supabase/functions/detect-ingredients/index.ts`
1. `OPTIONS` 프리플라이트와 모든 응답에 CORS 헤더(`Access-Control-Allow-Origin: *`, `Allow-Headers: content-type, authorization, apikey, x-client-info`).
2. `POST`만 허용. body의 `image`가 `data:image/(jpeg|png|webp);base64,` 로 시작하고 약 4MB 이하인지 검증.
3. `Deno.env.get("OPENROUTER_API_KEY")` 없으면 500 `{error}` (키 값은 로그에 남기지 않는다).
4. OpenRouter 호출: 모델 `google/gemma-4-31b-it:free`, `temperature 0.2`, user 메시지에 `text` + `image_url` 파트. 프롬프트는 PRD 5장 1단계 요지.
5. 응답 텍스트에서 코드펜스(```json) 제거 → `JSON.parse` → `ingredients` 문자열 배열 정규화(trim, 중복 제거, 1~30자, 최대 40개). 파싱 실패 시 1회 재시도, 그래도 실패하면 502.
6. OpenRouter 429 → 우리도 429 + 한국어 메시지.

### 1-2. `verify_jwt` 끄기
`supabase/config.toml`
```toml
[functions.detect-ingredients]
verify_jwt = false

[functions.generate-recipes]
verify_jwt = false
```

### 1-3. 배포
```bash
supabase functions deploy detect-ingredients --no-verify-jwt
```

### 1-4. `index.html` 1단계 UI
- 파일 선택/드롭, 미리보기, 캔버스 리사이즈(긴 변 1024px, JPEG 0.8) → data URL
- 상단 상수: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (공개 값만)
- `fetch(`${SUPABASE_URL}/functions/v1/detect-ingredients`, {method:'POST', headers:{'Content-Type':'application/json'}, body})` — 인증 헤더 없이 호출해 본다 (verify_jwt=false 확인 겸용)
- 재료 칩 렌더링, ✕ 삭제, 입력창 추가(중복/빈 값/40개 제한)
- 로딩·에러 상태, 재료 0개일 때 다음 단계 버튼 비활성화

### 검증
- [ ] 인증 헤더 없이 `curl -X POST .../functions/v1/detect-ingredients -H 'Content-Type: application/json' -d '{"image":"..."}'` 가 401이 아닌 200 반환
- [ ] 잘못된 body → 400, 한국어 `error`
- [ ] 냉장고 사진 업로드 → 칩 목록 표시, 삭제/추가 동작
- [ ] 재료 없는 사진·빈 목록 처리
- [ ] 브라우저 DevTools Network/소스에서 OpenRouter 키가 보이지 않음

---

## 2단계. 재료 → 레시피 3개

### 2-1. 함수 `generate-recipes`
`supabase/functions/generate-recipes/index.ts`
1. CORS·메서드·키 존재 확인은 1단계와 동일(공통 코드는 파일마다 복사 — 함수 간 import 공유는 하지 않음).
2. body `ingredients`: 문자열 배열, 1~40개, 각 1~30자 검증 후 정규화.
3. 모델 호출 `temperature 0.7`. 프롬프트는 PRD 5장 2단계 요지, 출력 스키마를 프롬프트에 예시로 포함.
4. 파싱·스키마 검증(제목/요약/조리시간 숫자/난이도 3종/재료 배열/순서 배열). 레시피가 3개 미만이거나 실패하면 1회 재시도 후 502. 3개 초과면 앞 3개.
5. 에러 형식·429 처리는 1단계와 동일.

### 2-2. 배포
```bash
supabase functions deploy generate-recipes --no-verify-jwt
```

### 2-3. `index.html` 2단계 UI
- "레시피 추천받기" 버튼 (재료 1개 이상일 때 활성)
- 카드 3개 렌더링: 제목, 요약, ⏱ 조리시간, 난이도 배지, 재료(보유=일반, 추가 필요=강조), 조리 순서 `<ol>`
- AI가 준 문자열은 모두 `textContent`로 삽입 (`innerHTML` 금지)
- 실패 시 에러 + 다시 시도, 재료 수정 후 재요청하면 결과 교체
- 각 카드에 "저장" 버튼 자리 (3단계에서 연결)

### 검증
- [ ] `curl`로 `{"ingredients":["계란","양파","우유"]}` → 레시피 정확히 3개, 스키마 일치
- [ ] 빈 배열/41개/비문자열 → 400
- [ ] 화면에서 3개 카드 표시, 보유/추가 필요 구분
- [ ] 재료를 빼고 다시 요청하면 결과가 바뀜

---

## 3단계. 프로필 + Supabase 저장

### 3-1. 마이그레이션 `supabase/migrations/001_init.sql`
PRD 5장 3단계의 테이블 DDL + RLS:
```sql
alter table profiles enable row level security;
alter table recipes  enable row level security;

create policy "anon read profiles"   on profiles for select to anon using (true);
create policy "anon create profiles" on profiles for insert to anon with check (true);

create policy "anon read recipes"    on recipes  for select to anon using (true);
create policy "anon create recipes"  on recipes  for insert to anon with check (true);
create policy "anon delete recipes"  on recipes  for delete to anon using (true);
```
적용: `supabase db push` (또는 MCP `apply_migration`). 적용 후 advisors로 보안 경고 확인 — "RLS 정책이 항상 true" 경고는 인증 없는 설계의 의도된 결과로 기록한다.

### 3-2. `index.html` 3단계
- supabase-js를 CDN ESM으로 로드 (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`, `<script type="module">`). 또는 fetch로 PostgREST 직접 호출해도 됨 (둘 중 코드가 더 단순한 쪽).
- 프로필: 이름 정리(trim, 공백 정규화, 1~20자 검증) → `profiles`에서 `name` 조회 → 없으면 insert. 동시 생성 충돌(unique 위반)은 재조회로 처리. `localStorage`에 `profile_id`/`profile_name` 저장, "변경" 버튼으로 해제.
- 저장: 프로필 없으면 이름 입력 모달 → `recipes` insert → 버튼을 "저장됨"으로 변경(중복 방지)
- 내 레시피: `profile_id` 필터, `created_at desc`, 접었다 펴는 상세, 삭제(confirm 후 delete)
- `localStorage` 접근은 try/catch (사파리 프라이빗 모드 대비)

### 검증
- [ ] 이름 "민수"로 입장 → 레시피 저장 → 새로고침 → 자동 입장 + 목록 유지
- [ ] "변경" 후 "지수"로 입장 → "민수"의 레시피가 보이지 않음
- [ ] "민수"로 다시 입장 → 저장했던 레시피 다시 보임
- [ ] 삭제 → 목록에서 사라짐, SQL로 행 삭제 확인
- [ ] 같은 레시피 저장 버튼 중복 클릭 시 1행만 생성
- [ ] 이름 0자/21자/공백만 → 거부

---

## 4단계. 마무리 점검

- [ ] 전체 흐름 1회: 사진 → 재료 편집 → 레시피 3개 → 저장 → 새로고침 → 재조회
- [ ] 모바일 폭(375px)에서 레이아웃 확인, 다크 모드 확인
- [ ] 에러 경로 확인: 네트워크 끊김, 429(연속 호출), 큰 이미지
- [ ] 키 유출 검사 (결과가 0건이어야 함)
  ```bash
  grep -rn "sk-or-" . --include="*" 2>/dev/null
  ```
- [ ] `list_edge_functions`/대시보드에서 두 함수 모두 `verify_jwt: false` 확인
- [ ] `get_advisors`로 보안 경고 확인, 의도된 항목(RLS true 정책) 외 없는지 확인
- [ ] 함수 로그에 이미지 base64나 키가 찍히지 않는지 확인

## 막힐 때 확인 순서

1. 401: 함수 `verify_jwt`가 정말 false인지 (재배포 시 `--no-verify-jwt` 누락 흔함)
2. CORS 에러: `OPTIONS` 처리와 `Allow-Headers`에 `apikey` 포함 여부
3. 429/502 반복: 무료 모델 한도 — 잠시 대기. 해결 안 되면 모델 교체 여부를 사용자에게 문의
4. JSON 파싱 실패: 모델 원문을 함수 로그(키·이미지 제외)에서 확인하고 프롬프트의 "JSON만 출력" 문구 강화
5. 저장 실패: RLS 정책과 `profile_id` 값 확인
