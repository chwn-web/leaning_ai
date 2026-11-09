# projects/

代码区。每个项目一个独立子目录，**建议各自独立 git 仓库**（方便单独开源、单独做 GitHub 展示）。

## 先看 `_template-py/`（所有项目的起点，主线）

`_template-py/` 是一份**零依赖、可直接运行**的 Python Agent 骨架，不是框架，是"每一层都能被追问"的可运行代码。

```powershell
cd projects/_template-py
python src/main.py            # 8 个场景：正常 / 参数自修复 / 死循环熔断 / 写操作拦截 / 幂等重放 / 预算终止 / 工具报错
python src/eval/run.py --k 3  # pass@k、pass^k、95% 置信区间、样本量警告
```

- 不需要 `pip install` 任何东西（Python ≥ 3.11，只用标准库）
- 七层分层 + ADR（为什么主线用 Python 而不是 TS）
- 开新项目的做法：复制整个目录，只改 3 个文件（`src/tools/builtin.py`、`src/main.py`、`data/golden.jsonl`）

详见 [`_template-py/README.md`](_template-py/README.md)、[`_template-py/docs/adr/0001-python-mainline.md`](_template-py/docs/adr/0001-python-mainline.md)。

## 再看 `_template/`（TypeScript 版，对照用）

同一套七层的 TS 实现，用来：① 需要前端集成时直接复用；② 对照两门语言写同一套架构的差异（面试聊"你只会一门语言吗"时有话说）。

```powershell
cd projects/_template
node src/main.ts              # 5 类场景
node src/eval/run.ts --k 3    # 评测
```

详见 [`_template/README.md`](_template/README.md)、[`../kb/03-框架/03-统一项目骨架.md`](../kb/03-框架/03-统一项目骨架.md)。

## 项目一览

| 目录 | 项目 | 周次 | 状态 | 简历价值 |
|---|---|---|---|---|
| `_template-py/` | 统一骨架（Python，主线） | W1 | ✅ 已完成 | 讲"分层与取舍"的实物证据 |
| `_template/` | 统一骨架（TS，对照/前端集成） | W1 | ✅ 已完成 | 同上的第二语言版本 |
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
