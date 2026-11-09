# Research: making video context verifiable and useful to coding agents

Research date: 2026-11-03

## Findings

- Video products increasingly make claims verifiable with clickable timestamps. Video Highlight describes answers with citations that jump to the source moment, including a one-click seek workflow ([Chat with Video](https://videohighlight.com/features/chat-with-video)).
- Developer workflow products reduce handoff friction by sending a ready-to-paste prompt to coding agents and treating recorded flows as repository artifacts that can be replayed in CI ([ScreenCI overview](https://screenci.com/docs/)).
- Grounding is a reliability concern, not just a convenience. The CVPR 2024 NExT-GQA paper reports that strong video-QA systems can answer correctly while failing to ground their answers in the relevant video evidence; it motivates returning the supporting moments with the answer ([paper](https://openaccess.thecvf.com/content/CVPR2024/papers/Xiao_Can_I_Trust_Your_Answer_Visually_Grounded_Video_Question_Answering_CVPR_2024_paper.pdf)).

## Product decision

OpenContext should lead with an evidence-linked developer handoff rather than a generic video chat. Preserve the existing Markdown and JSON exports, then attach a stable evidence ID, timestamp, and certainty to each atomic extracted claim. In the results viewer, citations and timeline ranges seek to the source video when playback is available. Keep interactions explicitly inferred.

This is an additive improvement to the existing product contract. A local MCP
server, repository-aware implementation briefs, and credential-free captured
context replay are implemented. Hosted connections still require separate
authentication, security, and deployment design.

## Implemented

- Worker output includes a sorted JSON evidence ledger and evidence markers in context Markdown.
- Optional text-model refinement falls back to the deterministic template if it changes an evidence-linked claim or timeline row.
- Job owners can confirm or flag evidence claims and export reviewer notes or suggested corrections without replacing the original extracted text.
- Context viewer evidence markers and timeline ranges seek the source player; when media streaming is unavailable, the selected timestamp is still shown.
- Open-source site copy and the project status notes describe the current implementation and verification work accurately.
- Deterministic implementation briefs combine evidence with repository
  technology signals without uploading repository contents.
- A local stdio MCP server exposes analysis, brief generation, and evidence
  lookup to coding agents.
- `opencontext replay` validates a committed context artifact and regenerates
  its implementation brief in CI without video, providers, or network access.
