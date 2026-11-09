# projects/

代码区。每个项目一个独立子目录，**建议各自独立 git 仓库**（方便单独开源、单独做 GitHub 展示）。

## 先看 `_template/`（所有项目的起点）

`_template/` 是一份**零依赖、可直接运行**的 Agent 骨架，不是框架，是"每一层都能被追问"的可运行代码。

```powershell
cd projects/_template
node src/main.ts              # 5 类场景：正常 / 参数错 / 死循环 / 写操作幂等 / 预算耗尽
node src/eval/run.ts --k 3    # pass@k、pass^k、95% 置信区间
```

- 不需要 `npm install`（Node ≥ 22 原生跑 TS）
- 七层分层 + 两份 ADR（为什么这么分层、为什么只有 transient 可重试）
- 开新项目的做法：复制整个目录，只改 3 个文件（`src/tools/builtin.ts`、`src/main.ts`、`data/golden.jsonl`）

详见 [`_template/README.md`](_template/README.md)、[`_template/docs/adr/0001-layering.md`](_template/docs/adr/0001-layering.md)、[`../kb/03-框架/03-统一项目骨架.md`](../kb/03-框架/03-统一项目骨架.md)。

## 项目一览

| 目录 | 项目 | 周次 | 状态 | 简历价值 |
|---|---|---|---|---|
| `_template/` | 统一骨架（可运行 demo） | W1 | ✅ 已完成 | 讲"分层与取舍"的实物证据 |
| `p0-llm-gateway/` | 多模型网关 | W1–W2 | 未开始 | 低（基础设施，但能讲成本与选型） |
| `p1-tool-agent/` | 工具型 Agent | W3–W9 | 未开始 | 中 |
| `p2-rag-agent/` | 知识库 Agent + 评测 | W10–W15 | 未开始 | **最高** |
| `p3-agent-platform/` | 可视化 Agent 平台 | W16–W21 | 未开始 | 高（开源） |
| `p4-product/` | 垂直场景产品 | W22–W24 | 未开始 | 高（真实用户） |

## 约定

1. **开工前先复制 `_template`**，不要从空目录手写——分层已经验证过，重写只会把时间花在脚手架上。
2. 先写 `README.md`（含验收标准），再写代码。
3. 每个项目根目录必须有：`README.md`、`.env.example`、一键启动脚本。
4. 提交信息用 `feat/fix/docs/chore` 前缀，面试官会看 commit 历史。
5. 不要提交 key；`.env` 进 `.gitignore`。
6. **每个项目必须至少主动踩过 1 个题库里的坑**（见 `plan/05-高频题库.md` 第 3 节映射表），并写进 README 的"已处理问题"。
