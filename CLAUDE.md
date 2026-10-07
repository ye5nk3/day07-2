# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 현재 상태

아직 구현 코드가 없고 설계 문서만 있습니다. 작업 전에 반드시 읽을 문서:

- `PRD.md`: 요구사항, 제약, 이미 정해 둔 결정 사항 (3장), 함수 요청/응답 스키마, DB 스키마
- `STEPS.md`: 구현 순서와 단계별 검증 체크리스트
- `7일차-바이브코딩-예시.pdf`: 수업 참고 자료 (앱 코드와 무관)

빌드·린트·테스트 도구는 없습니다 (npm 미사용). 구현 후 사용할 명령은 `STEPS.md`에 있습니다.

```bash
supabase functions deploy detect-ingredients --no-verify-jwt   # 함수 배포 (generate-recipes도 동일)
supabase db push                                               # supabase/migrations 적용
```

## 아키텍처 (계획)

냉장고 사진 → 재료 인식 → 레시피 3개 생성 → 이름 프로필로 Supabase에 저장하는 웹앱.

- **프런트엔드**: `index.html` 하나 (HTML/CSS/JS 인라인, 라이브러리는 CDN만). npm·번들러 금지.
- **AI 호출 경로**: 브라우저 → Supabase Edge Function 2개 → OpenRouter (`google/gemma-4-31b-it:free`). 브라우저가 OpenRouter를 직접 호출하면 안 됩니다.
  - `detect-ingredients`: base64 이미지 → `{ingredients: string[]}`
  - `generate-recipes`: 재료 배열 → `{recipes: [...]}` 정확히 3개
- **저장 경로**: 세 번째 함수 없이 브라우저가 anon 키로 PostgREST를 직접 호출합니다 (`profiles`, `recipes` 테이블). 인증 없이 이름만으로 프로필을 구분하므로 RLS 정책(anon의 select/insert, recipes만 delete)이 유일한 접근 제어입니다.

## 반드시 지킬 규칙

- `OPENROUTER_API_KEY`는 Supabase Secrets에만 있고 `Deno.env.get`으로만 읽습니다. 값을 코드, 문서, 로그 어디에도 쓰지 않습니다. service_role 키도 `index.html`에 넣지 않습니다 (Project URL과 anon 키는 가능).
- 두 함수 모두 `verify_jwt = false` (`supabase/config.toml` + 배포 시 `--no-verify-jwt`). 재배포 때 이 플래그가 빠지면 401이 납니다.
- 함수는 CORS 프리플라이트(`OPTIONS`)를 처리하고, 허용 헤더에 `apikey`를 포함해야 합니다. 함수 간 코드 import 공유 없이 공통 코드는 각 파일에 복사합니다.
- 무료 모델은 JSON 출력과 가용성을 보장하지 않습니다. 코드펜스 제거 후 파싱하고 실패 시 1회 재시도하며, 429는 사용자에게 한국어로 안내합니다.
- AI가 돌려준 문자열은 `textContent`로만 화면에 넣습니다 (`innerHTML` 금지).
- 모델 ID가 없거나 이미지 입력이 안 되면 임의로 다른 모델로 바꾸지 말고 사용자에게 먼저 물어봅니다.
- UI, 프롬프트, 응답, 문서는 한국어, 사용자에게는 존댓말로 응답합니다.
