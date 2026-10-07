# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 현재 상태

`PRD.md`(요구사항·결정 사항·스키마)와 `STEPS.md`(구현 순서·검증 체크리스트)가 기준 문서입니다. 1~3단계가 구현되어 있고, 4단계(마무리 점검)는 아직 하지 않았습니다. 단계는 사용자가 "N단계 실행"이라고 한 것만 진행합니다.

빌드·린트·테스트 도구는 없습니다 (npm 미사용, 자동화 테스트 없음). 검증은 STEPS.md의 체크리스트를 `curl`과 브라우저로 직접 수행합니다.

- 앱 실행: `index.html`을 브라우저로 엽니다 (서버 불필요).
- Supabase CLI는 이 환경에 설치되어 있지 않습니다. 함수 배포와 마이그레이션 적용은 Supabase MCP 도구(`deploy_edge_function`, `apply_migration`, `execute_sql`)로 하며, 대상 프로젝트는 `bkebbwsfwcnrrhbkrtyt`(Gestbook)입니다. 함수 소스와 마이그레이션 파일은 `supabase/` 아래에 두고 같은 내용을 배포합니다.
- 함수 직접 호출 예: `curl -X POST https://bkebbwsfwcnrrhbkrtyt.supabase.co/functions/v1/generate-recipes -H 'Content-Type: application/json' -d '{"ingredients":["계란","양파"]}'` (인증 헤더 불필요)

## 아키텍처

냉장고 사진 → 재료 인식(편집 가능) → 레시피 3개 생성 → 이름 프로필로 Supabase에 저장·조회하는 웹앱입니다.

- **프런트엔드**: `index.html` 하나 (HTML/CSS/JS 인라인, npm·번들러 금지). 섹션 ①②③이 같은 전역 상태(`ingredients`, `profile`)를 공유하고, 재료 목록이 바뀔 때마다 `renderChips()`가 추천 버튼 활성 여부까지 갱신합니다.
- **AI 호출 경로**: 브라우저 → Edge Function 2개 → OpenRouter(`google/gemma-4-31b-it:free`). 브라우저가 OpenRouter를 직접 부르지 않습니다.
  - `detect-ingredients`: base64 이미지 → `{ingredients: string[]}`
  - `generate-recipes`: 재료 배열 → `{recipes: [...]}` 정확히 3개 (스키마는 PRD.md 5장)
- **저장 경로**: 세 번째 함수 없이 브라우저가 publishable 키로 PostgREST(`/rest/v1`)를 직접 호출합니다. 프로필은 인증 없이 이름만으로 구분되므로 접근 제어는 RLS 정책과 테이블 GRANT뿐입니다.
- **DB 권한은 두 겹**: 이 프로젝트는 새 테이블에 `anon` 권한을 자동으로 주지 않습니다. RLS 정책과 별개로 `grant`가 있어야 하며(`profiles`: select·insert, `recipes`: select·insert·delete), 둘 중 하나라도 빠지면 42501 권한 오류가 납니다. update는 의도적으로 막혀 있습니다.

## 반드시 지킬 규칙

- `OPENROUTER_API_KEY`는 Supabase Secrets에만 있고 함수에서 `Deno.env.get`으로만 읽습니다. 이 프로젝트에는 `ai-reply` 함수(다른 용도)도 있으니 건드리지 않습니다.
- 두 함수는 `verify_jwt = false`입니다. MCP로 재배포할 때도 `verify_jwt: false`를 명시해야 하며, 빠지면 401이 납니다. 함수는 `OPTIONS` 프리플라이트를 처리하고 허용 헤더에 `apikey`를 포함합니다. 함수 간 import 공유 없이 공통 코드는 각 파일에 복사합니다.
- 무료 모델은 JSON 출력과 가용성을 보장하지 않습니다. 코드펜스를 제거하고 파싱하며 실패 시 1회 재시도하고, 429는 한국어로 안내합니다. 무료 모델 한도(429)가 오래 계속되어 실제 AI 응답은 아직 한 번도 확인하지 못했으므로, 그 부분을 "검증됨"이라고 쓰지 않습니다.
- AI가 돌려준 문자열과 DB에서 읽은 문자열은 `textContent`로만 화면에 넣습니다 (`innerHTML` 금지). 서식 기호 제거는 사용자가 하지 않기로 했으니 추가하지 않습니다.
- 모델 ID가 없거나 이미지 입력이 안 되면 임의로 다른 모델로 바꾸지 말고 사용자에게 먼저 묻습니다.
- 단계를 완성했다고 보고하거나 커밋하기 전에 시험하면서 만든 데이터(DB 행, 브라우저에 주입한 가짜 응답)를 모두 지우고 확인합니다. 시험 데이터 이름은 `__`로 감싸고, 삭제는 정확한 이름이나 ID로만 합니다.
- 시험으로 브라우저 창에 가짜 `fetch`를 주입했다면 시험 후 반드시 새로고침합니다. 그 창은 `data:` 주소라 `localStorage`를 쓸 수 없으니 자동 입장 시험은 별도로 해야 합니다.
- UI, 프롬프트, 응답, 문서는 한국어이고, 사용자에게는 존댓말로 응답합니다.
