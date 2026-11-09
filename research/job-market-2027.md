# 2026—2027 中国 AI Agent / LLM 应用工程师招聘要求与人才画像

> 调研时间：2026 年 11 月 9 日｜方法：中文招聘站（BOSS 直聘、猎聘、智联、禾蛙、JD 聚合站）真实 JD 抓取 + 中文技术社区/公众号复盘 + 英文 JD（Greenhouse/Ashby/Workday）+ HN 招聘线程
> **口径警告**：本报告所有薪资均为「招聘方挂牌月薪 / 聚合站统计中位数」，**不等于**实际 offer 总包（含期权、签字费、绩效）。国内聚合站之间存在 2 倍以上的口径差，凡是单一来源的数字都要打折看。

---

## 一、五条核心结论

1. **岗位已经从「概念词」变成有清晰边界的工种，但供给端严重简历通胀**：880 条 JD 拆解显示国内挂牌年包中位约 48 万，而同期候选人侧「十个有八个写精通 Agent」，能讲清落地/评估/异常链路的不到一成（[aiinfra.blog](https://aiinfra.blog/blog/agent-jd-report-2026-10/)、[CSDN 论坛](https://bbs.csdn.net/weixin_29055699/article/details/100564348)）。
2. **评测（Evals）是 2026 年唯一的硬通货**：4 场公开一面 4/4 都问到「测试集哪来的、准确率怎么算的」；HN 当月 276 条招聘贴最高频关键词同样是 Evals（[掘金](https://juejin.cn/post/7682710321412882478)、[HN 汇总](https://www.linkedin.com/posts/iamsom_i-read-all-276-job-posts-in-this-months-activity-7490191217373204481-WAT0)）。
3. **能力评价重心从 Prompt 迁移到 Context，2026 年进一步迁移到 Harness**（系统级约束、工具边界、验证回路），Prompt 调参已退化为工程里的一个零件，纯 prompt 岗位薪资被压在 10 万级（[阿里云](https://developer.aliyun.com/article/1725017)、[虎嗅](https://www.huxiu.com/article/4841931.html)、[Forestown 薪酬报告](https://en.forestown.com.cn/news_Detail/1783.html)）。
4. **MCP 已从加分项变成硬性筛选条件**，A2A 出现在多 Agent 岗位的职责原文里，LangGraph 与「Dify/Coze 低代码栈」在筛选中被错误地当成互斥项（[阿里云 JD 拆解](https://developer.aliyun.com/article/1760549)、[阶跃星辰 JD](https://datahub.ac.cn/ai-jobs/topics/ai-application-engineer-jobs.html)、[V2EX 反面案例](https://www.v2ex.com/t/1214160)）。
5. **市场是「结构性缺人 + 结构性过剩」并存**：脉脉报告称 AI 岗位暴增 8 倍、每 10 个新岗 3 个属 AI，但同报告 56% 研发反馈「越强越累」；自媒体「98 万岗位缺口」与百度校招后端 130+ 岗 vs 大模型研发 30+ 岗的现实严重背离（[脉脉报告解读](https://www.10100.com/article/158257516)、[什么值得买](https://post.smzdm.com/p/ae6vg48q/)）。

---

## 二、岗位名称谱系与职责边界

同一个技术栈被拆成至少 7 种 title，**title 决定面试侧重，比技术栈更影响通过率**（推断，依据是同一公司同技术栈不同 title 的 JD 职责差异）。

| 岗位名称变体 | 典型职责关键词 | 真实 JD 出处 |
|---|---|---|
| AI Agent 工程师 / AI 智能体开发工程师 | RAG、Function Calling、Tool Use、规划与推理、记忆机制；场景为智能客服、办公自动化、代码助手、游戏 NPC、深度研究 | 摩尔线程 北京 35-65K、25-50K（[DataHub](https://datahub.ac.cn/ai-jobs/topics/ai-application-engineer-jobs.html)） |
| LLM 应用工程师 / AI 应用开发 | Agent 架构、Workflow、RAG 技术选型；Python；基于 Agent SDK、LangChain 快速开发 | 智谱 AI 北京 20-40K（同上） |
| Agent 平台研发 / AIOS 研发 | 任务调度、上下文管理、知识检索、外部 API 调用；**基于 MCP/A2A 标准设计模块化可扩展工具接口** | 阶跃星辰 北京 30-55K、30-60K（两份 JD 重复出现同一句） |
| Code Agent / Coding Agent 算法 | 任务规划、工具调用、上下文管理、多轮交互、记忆机制、错误恢复；接入代码检索/文件编辑/终端执行/构建测试工具链 | 智谱 AI 北京 40-70K；阶跃星辰 北京 50-80K |
| Agent Tools / Agent 基础设施 | Tool/Skill 抽象与管理、多工具协同、Planning/Memory/Execution/Reflection 执行框架 | 智谱 AI 北京 30-60K |
| RAG / 知识检索方向 | 数据检索链路、召回与重排、知识库保鲜 | 猎聘 北京「AI 智能体研发工程师（数据检索方向）」23-35k·15 薪（[猎聘](https://www.liepin.com/a/79218153.shtml)） |
| AI Infra / 大模型应用算法 | 追踪 SOTA LLM/VLM/VLA、追踪 MCP/A2A 协议、撰写技术博客与参会 | 摩尔线程 北京 25-50K、上海 30-60K |

**职责边界的三条分水岭**（从 JD 原文归纳，非某一家之言）：
- **做 Demo vs 做交付**：国内 JD 高频动词是「构建/落地/接入」，海外 JD 高频动词是「ship / own / production」，[aiinfra.blog](https://aiinfra.blog/blog/agent-jd-report-2026-10/) 的结论是「国内更爱问 Agent 内部怎么转，海外更看重把东西交到客户手里」。
- **做功能 vs 做评测**：评测岗已独立成 title —— NVIDIA 专设 `Agent Evaluation and Self-Improvement Engineer`（[NVIDIA](https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Agent-Evaluation-and-Self-Improvement-Engineer_JR2028060-1)），智谱把「Agent 开发与评测」写进同一个岗位名。
- **做应用 vs 做产品化取舍**：智谱外派岗原文要求「在模型选型、工具调用、延迟、成本、安全合规之间做权衡」，把模糊需求转成架构+落地路线图+评测标准。

**中国市场的双轨结构**（[handbook 判断](https://github.com/harrisliangsu/ai-agent-engineer-handbook/blob/main/interview-prep/jd-requirements.md)）：大厂算法岗继续抢博士/顶会作者；中型厂与传统 IT/SaaS 把「AI Agent 工程师」当新工种放出，硬性要求高度趋同（Python + LangChain 系）。

---

## 三、硬性技能栈：必须 vs 加分

### 3.1 必须（多数 JD 的硬门槛）

- **Python**：技能命中率最高的单一技能。CSDN 167 岗统计 Python 88.0%（[CSDN](https://agent.csdn.net/6a8be94b662f9a54cb9fe5b5.html)）；AIJobFit 426 岗统计 27%（[AIJobFit](https://aijobfit.llmxfactor.cloud/role/ai_engineer)）。两个口径差 3 倍，说明「Python」在 JD 里常被默认为前提而不写出来 —— 调研时不能只看命中率。
- **至少一个 Agent 编排框架的实战**：LangGraph / LlamaIndex / AutoGen / CrewAI / OpenAI Agents SDK / Claude Agent SDK / Vercel AI SDK / Mastra 之一。海外 JD 的措辞是「production experience with **any of** LangGraph, Anthropic MCP, Google ADK, AutoGen, A2A, or LlamaIndex」（[Metropolis](https://job-boards.greenhouse.io/metropolis/jobs/8014511003)）——**考察的是编排范式理解，不是框架 API 记忆**。
- **RAG 全链路**：切分策略、向量库选型（pgvector vs Milvus 是面试真实追问）、召回/重排、知识库保鲜（[掘金](https://juejin.cn/post/7682710321412882478)）。
- **上下文与记忆管理**：多轮上下文压缩、长期记忆、会话状态。阿甘引 Manus 公开数字：一个 agent 任务平均几十次模型调用，输入输出 token 比接近 100:1（[阿甘](https://arganzheng.life/prompt-and-context-engineering.html)）——不理解这一点就做不了成本优化。
- **评测能力**：能自己造测试集、能说清样本量与置信区间。这是 2026 年最强的区分项，见第一节结论 2。
- **可观测性与可靠性五件套**：超时、重试（指数退避）、幂等 key、降级、多用户隔离；LangSmith/Langfuse + OpenTelemetry 是海外 JD 明写的（[CodeRoad](https://job-boards.greenhouse.io/coderoad/jobs/4436757009)、[HTMLPAGE](https://htmlpage.cn/topics/ai/frontend-to-ai-agent-interview-guide)）。
- **MCP 协议**：阿里云 JD 拆解明确「熟悉 MCP 协议优先」已不是加分项而是硬性筛选条件（[阿里云](https://developer.aliyun.com/article/1760549)）；海外岗甚至要求「**构建** MCP servers 与 connectors」而非仅会调用。

### 3.2 加分（决定薪资档位，而非决定是否进面）

- **A2A 多 Agent 协作协议**：阶跃星辰把「基于 MCP/A2A 标准设计工具接口」写进职责；摩尔线程把「追踪 MCP、A2A 等 Agent 协议」写进算法专家岗。
- **多档模型路由与成本工程**：CodeRoad 原文提到用 Sonnet/Opus 处理复杂推理、Haiku 处理高吞吐，按延迟/精度/成本动态路由；Metropolis 提到推理路由、缓存、语义检索降本。
- **微调与数据合成**：面壁智能「数据合成、微调、评估」三项并列；多数应用岗不要求，但算法侧岗位要求。
- **低代码平台（Dify / Coze / n8n / FastGPT）**：国内中小企业 JD 高频，但**大厂与 AI 原生公司几乎不写**。注意 V2EX 的真实教训：候选人用 LangGraph 构建被以「没用 Dify/CrewAI/AutoGen，技术不匹配」淘汰 —— 这是筛选荒谬性，不是能力缺陷，但求职时值得在简历里同时出现两类关键词（[V2EX](https://www.v2ex.com/t/1214160)）。
- **K8s / 云原生 / 分布式后端**：海外 Senior 岗的硬条件（6+ 年后端分布式），国内应用岗多为加分。
- **安全与合规**：prompt injection 防御、PII 脱敏、rate limiting、sandboxing、字段级权限（Metropolis、CodeRoad 均明写）。
- **技术影响力**：摩尔线程把「撰写技术博客/参与技术会议」写进 JD 职责 —— 这是国内少见的把输出能力制度化的例子。

### 3.3 协议与框架的生态位（2026 年现状）

MCP 已成工具调用事实标准，A2A 支撑多 Agent 协作，Dify/Coze 在国内各自圈地，AutoGen/CrewAI 在企业场景竞争，「LangChain 一家独大」的时代结束（[chenxutan](https://www.chenxutan.com/d/6031.html)）。**推断**：2027 年框架层会继续快速洗牌，把职业能力押在单一框架 API 上是高风险投资，押在「编排范式 + 协议 + 评测」上是低风险。

---

## 四、前端 / 全栈背景转 Agent：优势与被质疑点

### 4.1 真实优势（有出处，不是安慰话）

- **产品化能力是稀缺项**：前端做 Agent 不是劣势，而是「把智能体产品化」的最大优势 —— 交互思维、UI 实现、把复杂逻辑拆成组件的本能（[CSDN](https://adg.csdn.net/6a681e7b10ee7a33f2931ac6.html)）。
- **价值坐标已经转移**：从「把页面做出来」转向「让用户问题得到可靠解决」；真问题是「谁能使用 / 模型能看到哪些数据 / 回答是否有依据 / 出错能否定位 / 成本是否可控 / 下一位工程师能否复现」（[掘金](https://juejin.cn/post/7679618338582396938)）——这 6 问全都是全栈视角。
- **全栈 Agent 岗真实存在且给价不低**：MiniMax「AI 全栈工程师（Agent 方向）」上海 35-55K，职责就是前端+服务端+部分工具链，快速做 Demo/原型/内部工具；深言科技「AI 全栈开发工程师」明确写「可远程办公」（[DataHub](https://datahub.ac.cn/ai-jobs/topics/ai-application-engineer-jobs.html)）。

### 4.2 面试官会担心什么（按杀伤力排序）

1. **「后端是薄的」** —— 最致命。面试官的原话是给一个最小闭环（登录页→接口→写库→错误返回→部署），**不用 AI** 能不能走一遍；很多人卡在环境变量放哪、数据库连接为什么线上挂了、构建失败该看哪段日志（[David Yin](https://davidyin.dev/writing/vibe-coding-not-fullstack/)）。
2. **「会拼积木，解释不了机制」** —— 能跑通 LangChain 教程，但答不出为什么这么切分、为什么用这个向量库、失败时系统怎么退化（[HTMLPAGE](https://htmlpage.cn/topics/ai/frontend-to-ai-agent-interview-guide)）。
3. **「会做 Demo，缺工程闭环」** —— 可靠性、观测、权限、成本、回滚五件事一件没做（同上）。
4. **「会写 prompt，但不会让系统变可预期」** —— 这是 2026 年最容易被追问死的一条，因为 prompt 已不是核心能力（见第六节）。
5. **动机被怀疑** —— 「后端弱，所以想学 Agent 躲开全栈」这个动机本身就是扣分项，有访谈直接点出这类候选人（[掘金](https://juejin.cn/post/7697622920013987875)）。
6. **简历同质化** —— 纯前端技术栈在一叠雷同简历里托不起人；评审真正问的是「有没有把智能接进一条可维护、可观测、能和人协作的链路」（[牛客](https://www.nowcoder.com/discuss/911254093920763904)）。

### 4.3 面试能力分级（可直接当自测表）

L0 API 接入者 → L1 Prompt 操作员 → **L2 RAG + 工具应用工程师** → **L3 Agent 系统工程师（面试起点）** → L4 产品化负责人（[HTMLPAGE](https://htmlpage.cn/topics/ai/frontend-to-ai-agent-interview-guide)）。**推断**：多数前端转岗者停在 L1-L2 之间，卡点在「可靠性 + 评测」而非模型知识。

### 4.4 十二类高频追问（转岗者尤其要准备）

记忆与上下文如何裁剪｜RAG 与幻觉如何抑制｜Planning 是模型自主还是代码编排｜工具调用失败/超时怎么办｜并发与限流｜可观测性怎么做｜prompt 注入与越权防护｜成本如何压｜质量如何保证（测试集从哪来）｜如何产品化｜数据治理与权限｜**什么时候不该用 Agent**（最后这题最能筛掉「为了 Agent 而 Agent」的人）（[HTMLPAGE](https://htmlpage.cn/topics/ai/frontend-to-ai-agent-interview-guide)）。

---

## 五、薪资：一线城市 3-5 年与梯队差异

### 5.1 三个口径互相矛盾的统计（必须并列呈现）

| 来源 | 样本 | 中位/均值 | 备注 |
|---|---|---|---|
| [AIJobFit 一线页](https://aijobfit.llmxfactor.cloud/city/tier1/ai_engineer) | 北上广深 1204 条 JD（截至 2026-04-29） | 中位 **¥35k/月**，P25 ¥22k，P75 ¥50k | 北京/上海中位 ¥40k；深圳 ¥23k、广州 ¥17k 明显被拉低 |
| [CSDN 167 岗](https://agent.csdn.net/6a8be94b662f9a54cb9fe5b5.html) | 7 城 167 条（作者手工抓 BOSS） | 平均 **¥43.5k/月** | 按 15 薪约 65 万/年；文末为卖课软文，可信度打折 |
| [aiinfra.blog 880 条](https://aiinfra.blog/blog/agent-jd-report-2026-10/) | 国内 695 条（BOSS 435 + 猎聘 140） | 挂牌**年包中位 48 万** | 折合约 ¥32k/月×15 薪，与 AIJobFit 接近 |
| [Forestown 薪酬报告](https://en.forestown.com.cn/news_Detail/1783.html) | 自称汇总 5 平台 146 万人样本 | 行业平均年薪 **19.4 万**；多 Agent 架构类 **37.6 万** | 二手聚合，口径不明，只能看相对差 |

**结论（推断）**：一线城市 3-5 年、能独立交付 Agent 应用的社招，**挂牌月薪主区间 ¥30k-50k，年包 45-75 万**；能进头部 AI 公司可再上浮 40%-80%（Forestown 称头部总包比挂牌高 47%-82%）。

### 5.2 梯队差异（按公司类型）

- **头部 AI 原生公司**（阶跃星辰、智谱、面壁、MiniMax、摩尔线程）：JD 挂牌 30-80K，Code Agent 类 50-80K；固定薪资占比低、可变（奖金/股权）占 49%-64%（[Forestown](https://en.forestown.com.cn/news_Detail/1783.html)）。样本来自 [DataHub](https://datahub.ac.cn/ai-jobs/topics/ai-application-engineer-jobs.html)。
- **大厂平台/基础设施部门**：更看重分布式后端与 Infra 底子，薪资结构稳定，要求更高年限（推断，依据 Metropolis/CodeRoad 的 6+ 年、7+ 年门槛与中国大厂同类岗位描述趋同）。
- **传统 IT/SaaS 与中型厂**：年包 26-48 万（新一线）、15-26 万（二三线），要求低但技术债重，容易变成「一个人干全部」。
- **外包/交付型**：挂牌 20-40K，但「AI 应用测试」类岗位年薪仅 9.6 万、「基础 prompt 工程运维」10.1 万 —— 这是薪资分布的**下限锚点**，说明纯执行型岗位并不值钱（[Forestown](https://en.forestown.com.cn/news_Detail/1783.html)）。
- **远程/海外参照**：DOU 远程 Agentic AI Engineer $3500-4500/月（[DOU](https://jobs.dou.ua/companies/fuib/vacancies/367416/)）；美国 Senior/Lead 岗 $177k-$250k（[Metropolis](https://job-boards.greenhouse.io/metropolis/jobs/8014511003)、[CodeRoad](https://job-boards.greenhouse.io/coderoad/jobs/4436757009)）。**注意**：aiinfra.blog 明确说「远程岗位比想象中窄」，不要按海外薪资预期做职业规划。

### 5.3 溢价因子（有数据支撑）

多 Agent 编排、长链路任务调度、行业知识库适配这三项核心技能溢价 **77%-122%**；硕士比本科溢价 51%-86%；**端到端企业级 Agent 落地经验**比硕士学历再溢价 65%-110%（[Forestown](https://en.forestown.com.cn/news_Detail/1783.html)）。**推断**：落地经验 > 学历，这与脉脉报告「学历门槛放宽」的趋势一致。

---

## 六、2026 趋势：什么在贬值，什么在升值

### 6.1 贬值

- **Prompt 调参**：阿里云明确 2023 重 Prompt → 2025 重 Context → 2026 重 Harness，三者非替代而是分层，「模型是马，Harness 才是缰绳、马鞍与路」（[阿里云](https://developer.aliyun.com/article/1725017)）。Anthropic 侧的解读是 Prompt「已经退成上下文工程里的一个零件」（[NTLx](https://ntlx.github.io/articles/anthropic-context-engineering-prompt-retreat/)）。
- **「会调 API 就会做 AI 应用」**：秋招面试官反馈，去年沾 LLM 就能进面，今年十个有八个写「精通 Agent 开发」（[CSDN 论坛](https://bbs.csdn.net/weixin_29055699/article/details/100564348)）。
- **框架名词堆砌**：职坐标把「技术流水账」（罗列框架名/API/Prompt 数量）列为简历最大坑（[职坐标](https://blog.zhizuobiao.com/interview/interview-26091600003/)）。
- **纯手写代码速度**：InfoQ 引 OpenAI 一线观察，95% 工程师每天用 Codex，PR 评审从 10-15 分钟压到 2-3 分钟，重度使用者 PR 数高 70%（[InfoQ](https://www.infoq.cn/article/yEMrZMp6NTV8Rdj7lEQA)）。

### 6.2 升值

- **Harness Engineering**：Mitchell Hashimoto 2026 年 2 月 5 日命名，六天后 OpenAI 内部实验报告用同一词，Martin Fowler 为 Thoughtworks 分析站台（[虎嗅](https://www.huxiu.com/article/4841931.html)）。
- **上下文工程**：不稳定常因「这一步模型看到的信息不合适」，而非 prompt 不够复杂（[火山引擎](https://developer.volcengine.com/articles/7669358080304119862)）。
- **评测体系**：见第一节结论 2；NVIDIA 已把它独立成岗位。
- **Agent 工程化落地**：把模糊需求转成架构+路线图+评测标准，是智谱外派岗写进 JD 的首要职责。
- **多 Agent 编排与长链路调度**：77%-122% 的技能溢价直接对应这两项。
- **「能审 AI 产出」的判断力**：HN 讨论里招聘方明确说，现在只评 agent 给不出的东西 —— 可施工的 spec、能抓住错误结果的验证计划、审 agent PR 的判断力（[developertoolkit](https://developertoolkit.ai/en/org/hiring/)、[HN](https://news.ycombinator.com/item?id=49187792)）。
- **Tech Lead + 调度员**角色：有人同时盯 10-20 条并行线程（[InfoQ](https://www.infoq.cn/article/yEMrZMp6NTV8Rdj7lEQA)）。

---

## 七、招聘方最看重的 5 类可证明产出

按「面试中出现频率 × 区分度」排序，前两类几乎必问。

1. **一套自己建的评测集 + 回归流程**（最高权重）
   - 证据：4 场公开面 4/4 问评测；追问到「20 张图 95% 准确率的置信区间是 76%-99%，1000 张以上才有说服力」（[掘金](https://juejin.cn/post/7682710321412882478)、[Just Jason](https://junxinzhang.com/ai-agent-interview-real-signals/)）。
   - 合格形态：二三十条以上带标注的样本、能跑回归、能说清失败模式分布。
   - 推荐路径（原作者给的）：用 FastGPT/Dify 搭自用 → 建错题本 → 脱框架手写百行最小 Agent → 二三十条评测样本 → 开源/写博客。

2. **一个端到端跑在生产/真实用户手上的 Agent 案例**（第二高权重）
   - 海外最硬的措辞：Portless 要求「端到端交付过 ≥10 个 agentic workflows」，并明说 toy demos 不算（[HN 汇总](https://www.linkedin.com/posts/iamsom_i-read-all-276-job-posts-in-this-months-activity-7490191217373204481-WAT0)）。
   - 国内对应写法：业务场景 + 用户量 + 自动化率，而非技术栈清单（[职坐标](https://blog.zhizuobiao.com/interview/interview-26091600003/)）。
   - 范例句式：「把 12 个 if-else 意图分支改造成 Agent+工具调用，按失败模式拆检索-验证-兜底三层，坏 intent 从 23% 压到 6%」（[兔老板](https://www.songshunlp.com/resume-interview.html)）。

3. **可观测性/可靠性设计的具体决策**
   - 四组最小指标：任务（完成率/轮次/失败原因分布）、模型（调用次数/token/版本/拒答率）、工具（成功率/超时率/重试/幂等冲突）、体验（P50/P95/点踩/转人工率）（[HTMLPAGE](https://htmlpage.cn/topics/ai/frontend-to-ai-agent-interview-guide)）。
   - 能讲清「踩过什么坑、怎么解决的」比讲清架构更加分（[Just Jason](https://junxinzhang.com/ai-agent-interview-real-signals/) 的三层追问法：做了什么 → 为什么这么做（权衡代价）→ 踩过什么坑）。

4. **MCP server / Agent 工具的原创实现**（开源最佳）
   - Metropolis 把「开源 agent 框架或 MCP server 贡献」写进加分项；CodeRoad 把「构建 MCP servers 与 connectors」写成核心职责。
   - 国内：阿里云判断「有 Skill 封装和工程化落地能力」已是硬性筛选条件。

5. **技术写作 / 公开分享**
   - 摩尔线程把「撰写技术博客、参与技术会议」写进 JD 职责；Metropolis 加分项含 technical writing。
   - HN 侧对应的是「项目存在理由 = 真实问题 × 现成方案不足」（[Joye](https://www.joyehuang.me/en/blog/20260512---agentmockinterview/post)）。

**简历结构建议**（有出处）：定位 → 代表作 → 信任状，技术栈放最后（[牛客](https://www.nowcoder.com/discuss/866665373226041344)）；四件套 = 场景 → 职责 → 关键决策与权衡 → 可验证结果（[兔老板](https://www.songshunlp.com/resume-interview.html)）。

---

## 八、证据强度与不确定性

- **强证据**（多来源交叉 + 原文可查）：MCP/评测成为硬要求；Prompt 能力贬值；Agent 岗位 title 谱系；海外 JD 的技能清单。
- **中等证据**（单一聚合站，方法自述）：亿元级薪资区间、各城市中位数。CSDN 那篇文末是卖课软文，数字应打折；Forestown 自称汇总 146 万人样本但无法核验原始分布。
- **弱证据/需警惕**：自媒体传播的「全球仅 1.2 万人能做 Agent」「岗位 98 万」「中位年薪 120-250 万」——已有一线校招数据直接反驳（百度校招后端 130+ 岗 vs 大模型研发 30+ 岗，[什么值得买](https://post.smzdm.com/p/ae6vg48q/)）。
- **无法获取**：levels.fyi 的 AI/ML 岗位薪资页抓取失败（HTTP 405），海外数据只能用 JD 公开区间替代；多个博客站（aiinfra.blog）全文抓取被截断，只能引用搜索快照。

---

## 九、如果目标是 2027 年拿 offer：30 天最小行动

1. **先补后端地基，不要先补框架**：不用 AI 手写一遍「登录页→接口→写库→错误返回→部署」，卡在哪补哪（[David Yin](https://davidyin.dev/writing/vibe-coding-not-fullstack/)）。
2. **手写一个百行以内的最小 Agent**（不用 LangChain），把循环、工具调用、上下文裁剪、失败重试写一遍。
3. **为它建 30 条评测样本**，跑两版对比，记录失败模式分布 —— 这就是面试时唯一能打的底牌。
4. **接一次 MCP**：至少自己写一个 MCP server 并在 Claude Code / 任意客户端里跑通。
5. **写一篇复盘**：把「为什么这么设计、踩了什么坑、指标前后变化」写清楚，比五个 demo 有用。

> 最后一句对冲：市场对「能讲清链路的人」确实在抢，对「会拼框架的人」确实在挤。V2EX 上那位学完 Agent + 多智能体 + RAG 却全部已读不回的候选人，问题不在学习量，而在没有一条能被追问三层而不塌的链路（[V2EX](https://www.v2ex.com/t/1214160)）。
