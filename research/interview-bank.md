# AI Agent / LLM 应用工程师 面试题库与生产踩坑手册

> 调研日 2026-11-09｜66 题 + 16 个真实坑 + 18 个来源｜`【Sx】`=有来源，`【经验】`=工程推断；题目取自公开题库/工程博客，未引用无法核实的公司原题。

## 0. 使用说明

- 价值标记：`[低]` 背答案可过；`[中]` 需结合项目；`[高]` 能筛掉约 80% 候选人（经验判断，非统计数据）。
- 每题结构：原题/译题 → 考察意图 → 合格回答要点 3–5 条；`Sx` 对应文末 URL。
- 标注规则：句末有【Sx】的结论可回溯来源；未标的为工程经验综合（等同【经验】），别把经验说成论文结论。
- 公开面经以英文题库为主，中文题为意译；不声称覆盖所有公司，也不把“高频”包装成统计结论。
- 面试官真正追问的三层：**怎么衡量 → 为什么不用另一方案 → 线上坏了怎么定位**；只会第一层就是背答案。

## 1. LLM 基础

1. **"Walk me through what happens when you send a prompt to an LLM."（一次请求从 tokenizer 到出 token 发生了什么？）** [中] 意图：基本功是否成体系。
   - ① tokenize→embedding→每层 self-attention/MLP→logits；② prefill 并行处理 prompt，decode 逐 token 自回归；③ KV cache 复用历史 K/V；④ temperature/top-p 采样；⑤ 延迟拆 TTFT/TPOT/ITL。
2. **"Why is the context window not free? Explain KV cache growth."（上下文窗口为什么贵？KV cache 怎么增长？）** [高] 意图：能否算显存与成本。
   - ① attention 计算随长度 O(n²)，KV cache 显存随长度 O(n)；② 估算≈2×batch×layers×hidden×seq×字节（GQA 按 KV 头数再缩）；③ 7B/32 层/4K 已是 GB 级【S3】；④ MQA/GQA、PagedAttention、continuous batching 降本；⑤ 长上下文还有 lost-in-middle 的质量代价【S9】。
3. **"What does temperature actually do? Why is temperature=0 not reproducible?"** [高] 意图：是否真排查过“同输入不同输出”。
   - ① logits 除以 T 后 softmax，T→0 趋近 argmax；② top-p/top-k 截断；③ 即使贪心，浮点非结合、batch 组合、kernel/MoE 路由、并发都可能变；④ 评测要固定模型版本/参数/seed 并多次取样；⑤ 结构化任务低温，创意任务高温，别把温度当“正确率旋钮”【经验】。
4. **"Fine-tuning vs RAG vs prompt engineering: how do you choose?"** [高] 意图：选型是否跟风。
   - ① prompt 管行为/格式/边界；② RAG 管外部事实、新鲜度、可引用；③ 微调管风格/格式/领域分布/小模型蒸馏，不擅长注入可更新事实；④ 顺序通常是 prompt→RAG→微调，用 eval 决定；⑤ 可组合：小模型做路由/抽取，RAG 供事实。
5. **"How do you choose a model for a product?"** [中] 意图：是否用业务 eval 代替榜单。
   - ① 自建 100–300 条 golden，评任务成功率/格式/工具调用/成本/延迟；② 单测长上下文、中文、JSON、function calling；③ 路由：简单请求小模型、难请求大模型；④ 锁版本+回归；⑤ 公开榜只做初筛。
6. **"What causes hallucination and can you eliminate it?"** [高] 意图：是否知道边界。
   - ① 参数知识缺失/压缩、解码随机、上下文冲突、指令压力；② RAG 降幻觉但不消除；③ 引用+逐句 grounding+允许“不知道”；④ 工具/规则核验、约束解码；⑤ 高风险场景人工复核。
7. **"Explain KV cache, prefix caching, and why prompt order affects cost."** [高] 意图：成本优化实战。
   - ① KV cache 存每层历史 K/V，避免 decode 重算；② prefix caching 复用相同前缀；③ 稳定内容（system/tools/few-shot）放最前，动态内容放后；④ cache key 要含模型/版本/租户，工具描述变更会失效；⑤ 看命中率与账单，首 token 快不等于总成本低。
8. **"How would you speed up inference: quantization, speculative decoding, batching?"** [高] 意图：推理优化广度与取舍。
   - ① 先判 prefill-bound（TTFT）还是 decode-bound（TPOT）；② GPTQ/AWQ/GGUF 降显存/带宽，注意质量回退；③ speculative decoding 小模型草稿+大模型校验，拒绝采样保分布，代码/数学收益低；④ continuous batching/PagedAttention/FlashAttention 提吞吐（FlashAttention 省 HBM 往返而非 FLOPs）；⑤ 分别报质量/延迟/吞吐/成本【S3】。

## 2. Prompt / 上下文工程

1. **"How do you design few-shot examples? Is more always better?"** [中] 意图：有没有做过 shot 数 ablation。
   - ① 选贴近线上分布、覆盖边界与失败模式的例子；② 顺序、标签平衡、格式一致性会显著影响结果；③ 例子多占上下文且可能引入伪相关；④ 用 0/1/3/5-shot 在固定 eval 上比；⑤ 动态检索示例（example selection）优于固定堆砌。
2. **"When does CoT help and when does it hurt?"** [高] 意图：不把 CoT 当万能。
   - ① 多步推理/数学/规划受益；② 简单任务增加延迟与 token，可能引入新错误；③ 推理模型自带 thinking，不要重复“let's think step by step”；④ CoT 文本未必是真实决策过程，不能直接当审计证据【经验】；⑤ self-consistency 多次采样投票提稳定性。
3. **"How do you get reliable structured output?"** [高] 意图：工程落地能力。
   - ① JSON Schema/function calling/grammar 约束解码；② 严格 JSON 只保证语法，不保证字段语义与事实【S2】；③ 解析→schema 校验→业务校验→repair/带错误重问；④ 失败样本回流 eval；⑤ 流式场景先缓冲完整 JSON 再解析。
4. **"What is context engineering? How do you compress a long conversation?"** [高] 意图：是否理解 context rot。
   - ① 目标不是塞满窗口，而是把对当前决策有用的信息放对位置；② 分层：稳定规则/任务状态/工作笔记/检索证据；③ 摘要会丢归属、数字、引用，需保留结构化事实【S6】；④ working notes/checkpoint 可省 40–60% token【S6】；⑤ 压缩后重放关键约束并做一致性校验。
5. **"Why do models fail on long context even within the window?"** [高] 意图：读过论文/踩过坑。
   - ① lost in the middle：首尾信息利用最好，中间显著下降【S9】；② context rot：输入变长性能非均匀下降，主流模型都有【S8】；③ 干扰项与自相矛盾材料；④ 关键指令放首尾、分段结构化、用检索替代堆砌；⑤ 在目标长度上 eval，不能只测短样本。
6. **"How do you defend against prompt injection?"** [高] 意图：安全边界感。
   - ① 指令与数据分层（instruction hierarchy、分隔符、spotlighting）；② 不可信内容不得触发工具或外发；③ lethal trifecta：私有数据+不可信内容+外发通道同时具备即高危【S11】；④ 工具白名单、参数校验、不可逆操作人工确认；⑤ egress/输出过滤/审计，且没有只靠 prompt 的完美防御。
7. **"How do you use prompt caching without breaking correctness?"** [中] 意图：成本与一致性。
   - ① 稳定前缀放最前；② 动态用户内容放后；③ cache key 含模型/版本/租户；④ 工具描述/示例变更会使缓存失效，发布要预热；⑤ 监控命中率、TTFT 与账单。
8. **"Can I just put a 100k-word knowledge base in the system prompt?"** [低] 意图：是否区分指令与知识。
   - ① 成本/延迟高，且 lost-in-middle；② 知识更新要重发 prompt，不可运维；③ 知识走 RAG/工具，system 只放稳定规则与边界；④ 必须放时结构化分段+引用；⑤ 用 eval 证明不是“感觉更好”。

## 3. RAG

1. **"Walk me through a RAG pipeline end-to-end, and tell me where it usually breaks."** [高] 意图：全链路+失败定位。
   - ① 采集/解析→切分→embedding→索引→query 改写→召回→融合→rerank→组装→生成→引用；② 常见断点：解析丢表格、切分断语义、embedding 域不匹配、召回漏、rerank 错杀、上下文稀释、生成不忠实；③ 每段留指标；④ 先判定“答案在不在 top-k”，再分检索/生成责任【S5】。
2. **"How would you chunk documents for retrieval, and how do you know your chunking is good?"** [高] 意图：是否用 eval 而非拍脑袋。
   - ① 按标题/段落/代码函数等结构切，递归兜底，10–20% overlap【S5】；② 小块检索+父块/邻块扩展；③ 保留标题、页码、表格、ACL 等 metadata；④ 用端到端正确率+recall@k 比较切分方案，不看 chunk 是否“漂亮”；⑤ 不同文档类型分别调。
3. **"How do you choose and evaluate an embedding model?"** [中] 意图：embedding 不是默认越大越好。
   - ① 语言/领域/维度/最大长度/成本；② 在自有数据上比 recall@k，不看 MTEB 总榜；③ query/document 前缀与非对称检索；④ 归一化与距离度量要匹配训练方式；⑤ 版本锁定+重嵌入计划【S5/经验】。
4. **"Design a hybrid retrieval stack: BM25, vectors, and a reranker. What does each stage rescue?"** [高] 意图：分层召回/重排。
   - ① 向量与 BM25 各取 100–200；② RRF/加权融合；③ cross-encoder rerank 20–50 条；④ BM25 救精确词/ID，向量救语义，rerank 救排序；⑤ rerank 救不了没召回的（candidate recall 是天花板），相似度分数也不等于正确率，设延迟预算与降级【S1/S5】。
5. **"How do you evaluate retrieval separately from generation?"** [高] 意图：会不会拆指标。
   - ① 标注 query→相关 passage；② 检索看 recall@k/hit/MRR/nDCG；③ 生成看 faithfulness/answer correctness/citation（RAGAS 四维）【S1】；④ 先看答案是否在 top-k，再判生成【S5】；⑤ 线上看命中率、无引用回答占比、bad case 回流。
6. **"How do you handle multi-hop questions?"** [高] 意图：RAG 深水区。
   - ① 子问题分解/迭代检索/self-ask；② 每步保留证据与来源，最后统一引用；③ GraphRAG 适合实体关系与全局汇总，不是万能；④ 控制跳数与成本，设停止条件；⑤ 用多跳 golden 单独评。
7. **"What is GraphRAG and when is it worth it?"** [中] 意图：不盲目追新。
   - ① 实体/关系抽取+社区摘要/图检索；② 适合跨文档关系、全局性问题；③ 抽取成本、实体消歧、图过期、更新难；④ 常与向量检索混合；⑤ 先跑普通 RAG 基线，证明增益再上。
8. **"What are the common failure modes of RAG?"** [高] 意图：是否读过系统化总结。
   - ① 库里没有/缺内容；② top-k 没召回；③ 召回但没进上下文/被截断；④ 抽取/格式/粒度/完整性出错【S10】；⑤ 另加权限、过期索引、embedding 混版本、材料冲突。
9. **"RAG accuracy dropped 12 points in production this week and nobody shipped a prompt change. Debug it."** [高] 意图：生产排障。
   - ① 先看数据/索引：新文档、删除、解析失败、embedding 版本；② 拆 retrieval/generation 指标；③ 看 query 分布漂移与租户差异；④ 看模型版本/温度/上下文长度；⑤ 回放 trace+bad case，别先改 prompt。
10. **"Design RAG over 10M documents with per-user permissions: a user must never see data they can't access."** [高] 意图：权限与规模。
   - ① 索引侧 ACL/tenant namespace 过滤，不要先取 top-k 再后过滤（会把结果滤空）【S1】；② 增量同步+删除 tombstone；③ 分片/副本/缓存；④ 引用与审计；⑤ 权限泄漏红队测试。

## 4. Agent 架构

1. **"What is an agent? How is it different from a workflow?"** [中] 意图：概念清晰。
   - ① workflow 走预定义代码路径；agent 由模型动态决定步骤与工具【S14】；② 增量是循环+工具+状态；③ agent 成本/延迟/错误累积更高；④ 先找最简方案，复杂度只在可证明提升时加【S14】。
2. **"ReAct vs Plan-and-Execute: how do you choose?"** [高] 意图：架构取舍。
   - ① ReAct 交错 thought/action/observation，灵活但短视；② plan 先分解再执行，适合长任务/可并行；③ plan 要能 replan，否则一步错全盘错；④ 混合：高层 plan+低层 ReAct；⑤ 用成功率/步数/成本评。
3. **"How does function calling actually work? Does the model execute the tool?"** [高] 意图：常见误解。
   - ① 模型只输出 tool name+JSON args；② 运行时校验/执行/把结果回填为 observation；③ 模型不执行，也不保证参数合法【S2】；④ 支持并行调用与多轮；⑤ 工具错误要回填，让模型改计划。
4. **"Single tool-loop, planner-executor, or multi-agent: how do you choose an agent architecture?"** [高] 意图：不过度设计。
   - ① 单 loop 适合工具少、路径短；② planner-executor 适合可分解长任务；③ 多 agent 只在上下文隔离/并行/独立验证时；④ 多 agent 协调失败高（MAST 79% 来自协调而非能力），互相同意也不等于已验证【S6】；⑤ 2–3 个 specialist 常是甜点，5 个更差更贵【S6】。
5. **"How do you design tools for an agent?"** [高] 意图：ACI 功力。
   - ① 单 agent 2–5 个工具，>10 个行为不稳【S7】；② 名称/描述/参数像给初级开发写 docstring【S14】；③ 枚举、格式、边界、示例写清；④ 绝对路径、分页、幂等、错误可读；⑤ poka-yoke 让参数难传错，并把工具结果当不可信数据。
6. **"Give an agent memory across sessions without blowing up the context window or leaking between users."** [高] 意图：记忆不是“接个向量库”。
   - ① 分 working/episodic/semantic【S7】；② 结构化事实用 typed getter，别盲语义搜索；③ 写入策略/去重/冲突/时效；④ 租户隔离、删除、用户同意；⑤ 上下文只带摘要+按需检索。
7. **"An agentic loop runs forever on long-horizon tasks. Propose an algorithmic change to stop the looping and evaluate it offline."** [高] 意图：长任务可靠性。
   - ① 最大步数/时间/花费；② 状态哈希/动作去重/无进展检测；③ 每步要求可验证进展；④ replan/换策略/降级/人工；⑤ 离线轨迹评循环率、步数、成本【S4】。
8. **"How do you handle tool errors and partial failure?"** [高] 意图：错误恢复。
   - ① 错误分类：瞬时/永久/策略/权限；② 退避重试+抖动，限次数；③ 非幂等先查后重试/幂等键；④ 失败作为 observation 让模型改计划；⑤ 死信/人工接管/审计。
9. **"When is an agent the wrong answer? Argue against building one."** [高] 意图：senior 信号。
   - ① 路径固定→workflow；② 单次检索/生成够→不要 loop；③ 延迟/成本敏感；④ 高风险不可逆且无审核；⑤ 无法 eval/观测，先做简单基线【S14】。
10. **"Your agent fails 5% of the time mid-workflow, after executing real side effects. Make it safe."** [高] 意图：可靠性设计。
   - ① 副作用幂等/可补偿（saga）；② checkpoint+resume；③ 不可逆操作人工确认；④ 失败隔离/重放；⑤ 用 pass^k 而非 pass@k 评估，并监控/告警/回滚【S1】。

## 5. MCP / 工具协议 / 沙箱与权限

> 规范基线：MCP 2025-11-25；被问版本时先说版本，再答差异。

1. **"What is MCP? Why not just function calling?"** [高] 意图：概念边界。
   - ① JSON-RPC 2.0，host/client/server，client 与 server 1:1【S17】；② 服务端原语 tools/resources/prompts，客户端 sampling/roots/elicitation；③ 传输 stdio/Streamable HTTP；④ 初始化做能力协商；⑤ MCP 标准化发现/传输/鉴权，function calling 是模型输出协议，可叠加，不是替代【S2】。
2. **"Walk me through MCP lifecycle and capability negotiation."** [中] 意图：是否真用过。
   - ① initialize 请求/响应（protocolVersion/capabilities/serverInfo）；② initialized 通知；③ 按声明能力使用 tools/resources/prompts；④ 版本不兼容要降级/报错；⑤ 断线重连与会话恢复。
3. **"A customer wants to expose internal APIs to a model via MCP. Design it safely: auth, least privilege, versioning."** [高] 意图：安全工程。
   - ① OAuth 2.1，token 绑定 audience，禁止 token passthrough【S18】；② 最小 scope/逐步提权；③ 每工具参数校验，只读优先，写操作审批；④ 审计/限流/租户隔离；⑤ 不信任 tool description 与 result。
4. **"What is MCP tool poisoning? How do you defend?"** [高] 意图：新攻击面。
   - ① 恶意 server 在 tool description 藏指令，诱导读密钥/外发【S12】；② rug pull：批准后悄悄改工具；③ 固定版本/哈希，工具清单变更告警；④ 只装可信 server/沙箱，工具输出不当指令执行；⑤ 最小权限+egress。
5. **"Explain the MCP confused-deputy problem and token passthrough."** [高] 意图：OAuth 深水。
   - ① 代理用静态 client_id，攻击者借 consent cookie 绕过同意【S18】；② 必须 per-client consent、精确 redirect_uri、单次 state；③ token passthrough 被规范禁止；④ 下游校验 audience；⑤ 会话 ID 不能当认证。
6. **"How do you sandbox a local MCP server / computer-use agent?"** [高] 意图：权限工程。
   - ① 容器/独立用户/只读挂载；② 默认禁网/egress allowlist；③ 文件系统白名单；④ 每工具/每动作审批，密钥不进上下文；⑤ 审计/快照/回滚【S18】。
7. **"How do you version and roll out MCP tools?"** [中] 意图：协议工程。
   - ① 工具 schema 版本/兼容策略；② 能力协商+feature flag；③ 灰度/双跑；④ 工具描述变更视同 API 变更；⑤ 回滚。
8. **"MCP 和 Agent Skills 是什么关系？"** [低] 意图：概念辨析。
   - ① Skill 是提示/流程/资源包，不是后台服务；② 不能授予权限/代替沙箱【S2】；③ MCP 提供工具/资源连接；④ 二者组合；⑤ 别把 skill 当 agent。

## 6. 评测与可观测性

1. **"How would you evaluate a RAG system before letting a customer launch it?"** [高] 意图：eval-first。
   - ① 100–400 条分层 golden，冻结版本；② 检索 recall@k + 生成 faithfulness/correctness/citation；③ LLM judge+人工校准；④ 红线/abstain/权限用例；⑤ CI gate+灰度【S1】。
2. **"What are the biases of LLM-as-judge and how do you mitigate them?"** [高] 意图：评测严谨性。
   - ① 位置偏差→随机换位；② 冗长偏差→长度校正；③ 自我偏好→jury/多模型；④ 温度>0 不一致→多次投票；⑤ 格式偏差→贴合训练格式；对 partial hallucination 识别差，别用于细粒度事实【S13】。
3. **"How do you make evals reproducible?"** [高] 意图：工程化评测。
   - ① 固定模型版本/温度/seed/工具 mock；② 缓存输出/记录 trace；③ 数据集版本化/去污染；④ judge 版本固定+人工抽检；⑤ 报告置信区间：100 条约±8 分、400 条约±4 分【S1】。
4. **"Your refund agent succeeds on 70% of test tasks. Is it reliable enough to ship?"** [高] 意图：可靠性统计。
   - ① pass@k 是至少一次成功，pass^k 是 k 次都成功；② 生产要看 pass^k；③ 5% 单步失败在长链路会复利；④ 按任务风险定阈值；⑤ 报告分布而非均值【S1】。
5. **"How do you run online A/B for an LLM feature?"** [中] 意图：实验设计。
   - ① 主指标+护栏指标；② 样本量/实验时长；③ 按用户/会话分流，避免污染；④ 新奇特/季节效应；⑤ 灰度+回滚，并看 p95 成本/延迟。
6. **"What do you trace in an agent? Design observability."** [高] 意图：可观测性。
   - ① 每次 LLM/tool/retrieval 一个 span；② 输入/输出/token/成本/延迟/错误；③ 会话/任务/trace id；④ PII 脱敏/采样，可回放/对比；⑤ 告警：错误率、p95、成本、循环。
7. **"How do you evaluate an agent's trajectory, not just the final answer?"** [高] 意图：过程评测。
   - ① 工具选择/参数正确率；② 步数/成本/循环率；③ 中间证据/引用；④ LLM judge+规则+人工抽样【S4】；⑤ 失败分类。
8. **"How do you know a prompt/model change improved things?"** [中] 意图：回归。
   - ① 固定 eval set+基线；② 分层报告；③ 统计显著性；④ 线上灰度；⑤ 看 bad case 迁移，并防止过拟合 eval。

## 7. 工程化

1. **"Your agent workflow takes 30 seconds. Design the streaming UX, including what happens when it fails mid-stream."** [高] 意图：流式工程。
   - ① SSE/WebSocket，事件分 status/token/tool/error；② 先出计划/进度，降低焦虑；③ 工具参数不要混进正文；④ 断线可恢复/幂等；⑤ 失败给可重试/部分结果，并支持背压/取消。
2. **"How do you set timeouts and retries for LLM/tool calls?"** [高] 意图：稳定性。
   - ① 连接/读/总超时分开；② 指数退避+抖动；③ 重试预算/熔断；④ 非幂等不盲重试；⑤ 超时不等于业务未发生，配死信/告警【S2】。
3. **"The agent works in the pilot and falls apart between ten and fifty concurrent runs. Why?"** [高] 意图：并发。
   - ① 连接池/线程/事件循环阻塞；② 供应商 rate limit/配额；③ 内存/上下文膨胀；④ 共享状态/缓存击穿；⑤ 队列+背压+每租户限流，压测到 p95。
4. **"How do you make tool side effects idempotent?"** [高] 意图：分布式事务。
   - ① idempotency key；② 去重表/唯一约束；③ 先查后写/状态机；④ outbox/saga/补偿；⑤ 重放安全+审计。
5. **"How do you control token cost?"** [高] 意图：成本。
   - ① 拆输入/输出/缓存；② 路由小模型；③ 截断/摘要/检索+prefix cache；④ max_tokens/早停；⑤ 每任务预算+告警；案例：70% 调用迁到便宜模型后，负载 3.2× 时月成本从峰值 $14,200 降到 $6,800【S6】。
6. **"How do you roll out a prompt/model change safely?"** [中] 意图：发布。
   - ① prompt/version 管理；② 离线 eval gate；③ 影子/灰度；④ 回滚+监控漂移；⑤ 变更审计。
7. **"How do you prevent multi-tenant data leakage?"** [高] 意图：SaaS 安全。
   - ① tenant_id 全链路；② 向量 namespace/ACL；③ cache key 前缀；④ 日志/评测隔离，密钥/KMS；⑤ 删除/导出+越权测试。
8. **"What changes when you go from demo to production?"** [中] 意图：工程成熟度。
   - ① 失败处理/重试/降级；② 观测/告警；③ 评测/回归；④ 成本/配额；⑤ 安全/合规+人工接管+文档/SLA。

## 8. 系统设计

1. **"Design an enterprise knowledge base agent."** [高] 意图：综合架构。
   - ① 连接器/增量同步/删除；② 解析/OCR/表格；③ 切分/元数据/ACL；④ hybrid+rerank+引用+权限过滤；⑤ eval/反馈/观测，无答案时 abstain。
2. **"Design an agent that can operate a browser."** [高] 意图：感知/动作/安全。
   - ① 感知 DOM/a11y+截图；② 动作空间/元素定位；③ 等待/校验/重试；④ 沙箱/凭据注入+不可逆操作确认；⑤ 轨迹回放/eval+captcha/人工接管。
3. **"Design multi-tenant isolation for an agent platform: prompts, vector stores, caches, and evals."** [高] 意图：平台化。
   - ① 控制面/数据面；② 租户隔离（prompt/vector/cache/eval）；③ 工具网关/权限；④ 配额/计费；⑤ 可观测/审计+版本灰度+数据驻留/删除。
4. **"Design a customer-support agent with order-status and returns tools. How do you keep it safe and useful?"** [高] 意图：业务落地。
   - ① 意图路由；② 工具查询/退款；③ 策略引擎/额度/审批；④ 幂等/审计；⑤ 人工 handoff+安全（注入/越权）+评任务解决率/CSAT。
5. **"Run an LLM over 10 million records nightly, within budget. Design the batch pipeline."** [高] 意图：批处理。
   - ① 对象存储/队列/分片；② batch API/并发限流；③ 去重/断点/重试；④ 成本估算/采样质检；⑤ 输出校验/失败隔离+增量。
6. **"Design a code agent that can modify a repository safely."** [高] 意图：代码 Agent。
   - ① 生成与验证分离；② 沙箱/只读基线/分支；③ 测试反馈/self-repair 上限；④ diff 审查/回滚；⑤ 权限/密钥+评任务成功率/回归。

## 9. 真实开发中的坑（现象→原因→解法）

**P1 工具调用参数不是合法 JSON**
- 现象：arguments 含未转义换行/控制字符，`JSON.parse` 抛错，调用到不了 handler → 原因：模型按自然语言生成 JSON，长参数/代码/多语言更易坏【S15/S16】 → 解法：缓冲完整串、jsonrepair 兜底、schema 校验、把解析错误回填让模型重发、埋点统计失败率。
**P2 工具参数幻觉**
- 现象：编造订单号/枚举值/日期，或把 A 记录写到 B → 原因：schema 只有类型没有业务约束，工具描述含糊，模型缺上下文【S4】 → 解法：enum/min/max/pattern、服务端二次校验、先查询后写入、dry-run、错误信息可读、关键写操作审批。
**P3 上下文爆炸与压缩腐化**
- 现象：长任务越跑越慢/贵；压缩后日期、人名、引用归属漂移且不报错 → 原因：摘要把结构化引用压成转述，上下文超限【S6】 → 解法：working notes/checkpoint、只带摘要+可检索原始记录、压缩后重放关键约束、保留 doc/span id、超 10 条消息重新校验【S6】。
**P4 重试风暴**
- 现象：一夜 $1,800、312 次重试，或 11 天 $47,000 → 原因：超时/429 后无上限重试，多个 agent 共享失败依赖【S6】 → 解法：重试上限 3、指数退避+抖动、每任务预算、熔断、死信队列、prompt 告知“第 N 次，换策略或停止”、非幂等先查状态。
**P5 多 Agent 交接失真**
- 现象：研究者 5 条引用到写手只剩 4 句摘要，结论被改写 → 原因：自由文本 handoff 丢来源/约束，协调失败【S6】 → 解法：结构化 handoff manifest/JSON schema、保留 citations、减少 agent 数、2–3 个 specialist、端到端 eval。
**P6 检索不到/答非所问**
- 现象：答案明明在库里，模型说不知道或引用错段 → 原因：切分断语义、embedding 不匹配、召回漏、rerank 错杀、上下文稀释【S10/S5】 → 解法：混合检索+rerank、query 改写、父子块、recall@k 定位、答案在 top-k 才怪生成。
**P7 权限后过滤把 top-k 滤空**
- 现象：用户有权限的文档没出现，或越权文档被引用 → 原因：先全局检索再按 ACL 过滤，过滤后剩 0–1 条【S1】 → 解法：索引侧 ACL/namespace 预过滤、按租户分片、over-fetch+二次校验、权限测试集。
**P8 换 embedding 模型不重灌/混版本**
- 现象：没报错、没告警，答案质量下降；新旧向量 cosine 近 0 → 原因：query 用新模型、库内存旧向量，向量空间不兼容【S1】 → 解法：索引版本化、双写/蓝绿、全量重灌、shadow eval、回滚方案。
**P9 流式输出与工具调用冲突**
- 现象：工具参数被当正文吐给用户，或 JSON 未收完就解析失败 → 原因：token 流与 tool_call 流混在一起，缺少事件类型【经验】 → 解法：分离 text/tool_call 事件、缓冲完整参数、先发状态再发正文、断线可恢复、前端按事件渲染。
**P10 “JSON 模式”不等于正确**
- 现象：JSON 合法但字段缺失/枚举错/事实错 → 原因：约束解码只保语法，不保语义【S2】 → 解法：schema+业务校验、repair、重问、单测覆盖边界、失败样本回流。
**P11 长上下文失效**
- 现象：文档一长就漏中间条件、忽略指令 → 原因：lost-in-middle/context rot，注意力与训练分布问题【S8/S9】 → 解法：关键信息放首尾、分段结构化、检索替代堆砌、在目标长度 eval、压缩去噪。
**P12 评测不可复现**
- 现象：同一 eval 今天 82 明天 76，judge 结论飘 → 原因：模型版本漂移、温度>0、judge 偏差、工具状态变化、数据污染【S13】 → 解法：锁版本/温度/seed、缓存输出、judge 多票+换位、人工校准、数据集版本化。
**P13 并发上来就崩**
- 现象：10 路正常，50 路超时/429/内存涨 → 原因：连接池、rate limit、上下文内存、共享缓存击穿【S1/经验】 → 解法：队列+背压、每租户配额、信号量、流式释放、压测 p95、降级模型。
**P14 间接提示注入外泄**
- 现象：Agent 读了网页/邮件后把私有数据发到外部 → 原因：lethal trifecta 同时具备，模型分不清指令与数据【S11】 → 解法：不可信内容不触发外发、工具白名单、egress allowlist、敏感操作人工确认、密钥不进上下文。
**P15 超时被当成“没发生”**
- 现象：重试导致重复退款/重复发信 → 原因：读超时只代表客户端放弃，服务端可能已执行【S2】 → 解法：幂等键、先查后写、状态机、outbox、对账、重试前查询业务状态。
**P16 Token 成本失控**
- 现象：一周账单翻倍，长尾任务烧钱 → 原因：上下文重复、工具结果全量回填、无 max_tokens、全部走大模型【S6】 → 解法：拆 token 账、路由小模型、prefix cache、结果截断/摘要、每任务预算+告警、按租户配额。

## 10. 价值分级：哪些是“背答案”，哪些能筛人

| 低价值（背答案可过） | 高价值（经验判断，约筛掉 80%） |
|---|---|
| 什么是 token / 上下文窗口 | 长上下文为何失效、KV cache 怎么算 |
| ReAct 三步是什么 | 何时不该用 agent、单/多 agent 取舍 |
| MCP 是什么、和 FC 区别 | MCP tool poisoning / confused deputy 怎么防 |
| RAG 三步是什么 | RAG 掉点如何分层排查、权限后过滤 |
| temperature 是什么 | temp=0 为何仍不可复现 |
| LLM-as-judge 怎么用 | judge 偏差、校准、pass^k |
| 怎么设超时/重试 | 超时≠未发生、幂等、重试风暴 |
| prompt 怎么写 | context engineering、压缩腐化、长上下文 eval |
| 向量库怎么选 | 混合检索各阶段救什么、embedding 升级 |

判断标准：低价值题有唯一名词定义或固定三步；高价值题给一个故障/约束，要求你拆指标、做取舍、说失败边界。面试官通常追三层：“怎么衡量→为什么不用另一方案→线上坏了怎么定位”。`能筛掉 80%` 是经验分级，不是统计结论；公开题库没有通过率数据。

最高价值 5 类（经验判断，按公开题库密度与区分度）：RAG 故障诊断/权限；Agent 架构取舍与长任务可靠性；评测体系/pass^k/judge 偏差；MCP 权限与提示注入；成本/并发/重试工程化。

## 11. 来源

- **S1** https://fdeinterviews.com/c/rag-agents — RAG & AI Agent 84 题；eval-first、pass^k、权限后过滤、embedding 混版本、重试风暴等场景题。
- **S2** https://whyalwaysme.lol/interview/agent-skills/ — 《AI 应用工程八股文》160 问；八个“常见错误结论”（JSON≠正确、调用≠执行、MCP≠FC、超时≠未发生等）。
- **S3** https://www.songshunlp.com/inference-interview.html — 推理优化：TTFT/TPOT、KV cache 估算、PagedAttention、量化、投机解码。
- **S4** https://www.songshunlp.com/agent-interview.html — Agent 基础、ReAct、工具参数幻觉、LangGraph、记忆分层、长任务崩点、Agent 评测。
- **S5** https://www.songshunlp.com/rag-interview.html — RAG 十问：切分、混合检索、rerank、多跳、评估、引用。
- **S6** https://marklaursen.com/blog/18-months-production-ai-agents-lessons — 18 个月/140 万次调用/23 份 postmortem；五大失败模式与成本数据。
- **S7** https://www.newtuple.com/post/5-learnings-from-developing-ai-agents-in-production — 单职责 Agent、2–5 工具、三类记忆、三层评测。
- **S8** https://www.trychroma.com/research/context-rot — Context Rot：输入变长性能非均匀下降。
- **S9** https://arxiv.org/abs/2307.03172 — Lost in the Middle：首尾强、中间弱。
- **S10** https://arxiv.org/abs/2401.05856 — Seven Failure Points of RAG。
- **S11** https://simonwillison.net/2025/jun/16/the-lethal-trifecta/ — Lethal Trifecta：私有数据+不可信内容+外发通道。
- **S12** https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks — MCP Tool Poisoning / rug pull 案例。
- **S13** https://github.com/huggingface/evaluation-guidebook/blob/main/contents/model-as-a-judge/tips-and-tricks.md — LLM judge 偏差与缓解。
- **S14** https://www.anthropic.com/engineering/building-effective-agents — workflow vs agent、五种模式、ACI/工具设计。
- **S15** https://github.com/openclaw/openclaw/issues/9916 — tool arguments 非法 JSON，JSON.parse 失败。
- **S16** https://github.com/aaif-goose/goose/issues/2892 — 未转义控制字符导致 tool call JSON 解析失败。
- **S17** https://modelcontextprotocol.io/specification/2025-11-25/architecture — MCP host/client/server、JSON-RPC、能力协商。
- **S18** https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices — confused deputy、token passthrough、SSRF、会话劫持、本地 server 沙箱、scope 最小化。
