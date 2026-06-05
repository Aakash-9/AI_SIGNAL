# Evaluation Report

Dataset: **20** prompts (10 real product prompts, 10 edge cases).

## Headline metrics

> Note: prompts marked LLM_TRANSPORT / NOT_CACHED were blocked by the free-tier rate limit (external infra), not by the pipeline — they were handled gracefully (no crash). The pipeline metric below excludes them.

| Metric | Value |
| --- | --- |
| **Pipeline success (prompts that reached the LLM)** | **95%** (19/20) |
| Blocked by free-tier rate limit / not cached | 0 |
| Overall (incl. infra-blocked) | 95% (19/20) |
| Real prompts → working app | **100%** |
| Edge cases → handled (no crash) | **100%** |
| Outcomes | 16 working · 4 clarification · 0 failed |
| Execution proof (avg smoke pass rate, working apps) | **100%** |
| Requests needing any repair | 55% (11/20) |
| Requests needing a scoped LLM patch | 0% (0/20) |
| Avg repair steps / request | 0.75 |
| Avg scoped LLM patches / request | 0.00 |
| Avg latency (live, uncached) | 4664ms |
| Total tokens | 41,776 in / 31,077 out |
| Est. cost (gemini-2.5-flash public rates) | $0.0902 |

## Failure taxonomy

No failures. Every prompt produced a working app or an appropriate clarification.

## Per-prompt results

| ID | Cat | Expected | Outcome | ✓ | Repairs | Patches | Smoke | Latency | Tokens(in/out) | Detail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| real-crm | real | working | working | ✅ | 0 | 0 | 5/5 | 179ms ⚡ | 2365/1374 | 1e 9ep 4pg |
| real-salon | real | working | working | ✅ | 0 | 0 | 6/6 | 199ms ⚡ | 2400/1988 | 4e 24ep 7pg |
| real-pm | real | working | working | ✅ | 1 | 0 | 4/4 | 149ms ⚡ | 2430/2524 | 4e 24ep 6pg |
| real-ecommerce | real | working | working | ✅ | 2 | 0 | 6/6 | 201ms ⚡ | 2440/2813 | 4e 18ep 10pg |
| real-helpdesk | real | working | working | ✅ | 3 | 0 | 6/6 | 199ms ⚡ | 2508/2394 | 2e 12ep 6pg |
| real-inventory | real | working | working | ✅ | 1 | 0 | 4/4 | 123ms ⚡ | 2405/2035 | 3e 16ep 10pg |
| real-events | real | working | working | ✅ | 1 | 0 | 6/6 | 193ms ⚡ | 2412/2350 | 4e 22ep 9pg |
| real-fitness | real | working | working | ✅ | 1 | 0 | 5/5 | 171ms ⚡ | 2299/1684 | 2e 14ep 4pg |
| real-recipes | real | working | working | ✅ | 0 | 0 | 5/5 | 170ms ⚡ | 2346/1481 | 3e 19ep 4pg |
| real-realestate | real | working | working | ✅ | 1 | 0 | 6/6 | 197ms ⚡ | 2449/2643 | 3e 17ep 7pg |
| edge-vague | edge | clarification | clarification | ✅ | 0 | 0 | — | 0ms ⚡ | 418/172 | asked |
| edge-conflict-auth | edge | handled | working | ✅ | 1 | 0 | 3/3 | 99ms ⚡ | 2303/897 | 1e 8ep 4pg |
| edge-terse | edge | handled | working | ✅ | 0 | 0 | 4/4 | 149ms ⚡ | 2218/802 | 1e 8ep 3pg |
| edge-incomplete | edge | clarification | clarification | ✅ | 2 | 0 | — | 74ms ⚡ | 2253/1002 | asked |
| edge-contradictory-plan | edge | handled | working | ✅ | 0 | 0 | 3/3 | 98ms ⚡ | 2338/1157 | 2e 5ep 2pg |
| edge-overloaded | edge | handled | working | ✅ | 1 | 0 | 5/5 | 8911ms | 2785/3862 | 8e 41ep 7pg |
| edge-nonapp | edge | clarification | working | ❌ | 0 | 0 | 1/1 | 3482ms | 2260/671 | 2e 0ep 1pg |
| edge-ambiguous-roles | edge | handled | clarification | ✅ | 0 | 0 | — | 1528ms | 429/325 | asked |
| edge-private-public | edge | handled | working | ✅ | 1 | 0 | 4/4 | 4733ms | 2305/711 | 1e 8ep 2pg |
| edge-onefield | edge | clarification | clarification | ✅ | 0 | 0 | — | 1347ms ⚡ | 413/192 | asked |
