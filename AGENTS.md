# deeptutor-lite 开发经验总结

> 合并自三份记录：`session-summary-2026-08-03.md`（重建与开源）、`deeptutor-lite/HANDOFF.md`（2026-08-06 交接）、2026-08-06/07 TUI 打磨 session（本文件作者实时记录）
> 适用读者：后续接手 deeptutor-lite 或开发同类 ink TUI / pi 扩展的开发者

---

## 1. 项目总览

| 项 | 值 |
|---|---|
| 定位 | 独立 AI 文档辅导 CLI（轻量版，替代 ~1GB 的 deeptutor 重量级系统） |
| 技术栈 | ink 7 + React 19 TUI、TypeScript/ESM、Node ≥22 |
| 引擎 | `@earendil-works/pi-agent-core`（AgentHarness）+ `pi-ai` 模型运行时 |
| RAG | pi-knowledge v0.5.2（schema v4）移植 |
| 会话 | JsonlSessionRepo |
| 环境 | Windows Terminal + pwsh，中文（CJK/全角字符多次成为 bug 根因） |
| GitHub | https://github.com/leonyvon/deeptutor-lite（public，`pi install git:github.com/leonyvon/deeptutor-lite`） |

核心功能模式（11 个）：聊天、web_search、kb 管理、python_run、mastery（quiz/grade/assess/build 等）、RAG 问答、会话管理、命令面板、模型切换。

---

## 2. 开发历程

### 阶段一（2026-08-03）：从重建到开源
1. **架构决策**：brainstorm → spec → 21 任务计划 → 实现 → 验证（产出 `docs/superpowers/specs/2026-07-21-deeptutor-lite-design.md`、`plans/2026-07-21-deeptutor-lite.md`）
2. **环境**：pi 0.80.10 / Node v24.15.0 / Python 3.13.5；pi-knowledge 装到 `~/.pi/agent/extensions/pi-knowledge`（`npm install --legacy-peer-deps`，tree-sitter peer 冲突）
3. **13+ 扩展工具**：web_search（Brave）、kb_list/switch/create、python_run、mastery 全家桶
4. **环境变量**（User 级）：`BRAVE_API_KEY`、`PI_KNOWLEDGE_EMBEDDING=openai:nomic-embed-text`、`PI_KNOWLEDGE_EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1`
5. **Skills + Prompts**：6 个 SKILL.md + 5 个 workflow
6. **问题修复轮次**（见 §3.1）
7. **pi 升级 0.80.10 → 0.83.0**：扩展/skills/prompts 实测不清空
8. **pi-package 打包 + 开源**：manifest + peerDependencies、junction 安装闭环（install.ps1）
9. **目录改名** `my-deeptutor` → `pi-agent-development`：仓库零硬编码；唯一破坏点 = 8 个 junction 指向旧路径；install.ps1 已加固（Get-Item 替代 Test-Path）

### 阶段二（2026-08-06/07）：TUI 交互打磨（本次 session 核心）
1. **视觉系统**：主题 token（opencode 配色）、Markdown 渲染器（marked 18 + CJK 精确切行）、shiki 代码高亮、角色色、MessageList 扁平行缓冲滚动
2. **粘贴链路**：bracketed paste 三连修 → 最终 ink 官方 `usePaste`（见 §3.2.1）
3. **光标/IME**：隐藏硬件光标 + 锚定到输入框 caret + 自绘 ✏️（见 §3.5）
4. **鼠标划词**：SGR mouse + 应用自绘选区 + 剪贴板复制（见 §3.4）
5. **键盘重构**：↑↓ 光标跨行、Ctrl+Enter 换行、Ctrl+C 智能清空、`exitOnCtrlC:false`
6. **粘贴区块演化**（本 session 最大主线）：
   - v1 `c782ebf`：区块数组，输入框内多区块、Backspace 删除
   - v2 `1c81159`：parts 模型重构（区块 = 输入流占位符），修复 mergeParts/insertText/insertBlock 三缺陷 + 空输入崩溃
   - v3 `8ff09e7`：行内填充占位符（opencode 对齐）：warning 黄色填充矩形 + ✏️ 光标统一 + buildLines 共享排版
   - v4 `b88b548`：换行溢出修复 A（软换行：✏️ 插入撑宽 + flex 压缩 + block 拆行）
   - v5 `13e87f8`：换行溢出修复 B（硬换行：buildLines 不处理 `\n`）

### 阶段三（2026-08-07）：交互闭环（回退/中断/选择器/IME/划词）

1. **/rewind 回退 + 双击 ESC 中断**：核心复用 pi-agent-core 现成原语——`harness.navigateTree(entryId, {summarize:false})` 非破坏回退（回退到 user prompt 时返回 `editorText` 自动填回输入框，回退到 assistant 回答则停在原处继续）、`harness.abort()` 中断（agent_end 事件流自动收尾，部分回答保留）；`esc.ts` 双击检测（400ms 窗口，仅 chat 模式激活）
2. **划词复制全覆盖**：MessageList 全部行类型（user/label/tool/error/streaming）统一走 `applySelection`（`lineToSegments` 合成带原样样式的段）；TextInput 选区高亮（输入框独立列基准 `screenColBase`，**不能**复用消息区 PAD_COLS）+ `extractInputSelectionText` 输入区提取（block 计入标签字符、padding 列不复制）；修复了段起始列偏移（`segStart`）bug
3. **IME 拼音右下角闪烁**：光标锚定写在 React 被动 effect，在 ink 帧写入**之后**的下一个任务才执行——TSF `GetTextExt` 在间隙查询到右下角 → 修复一：同 write 追加光标定位序列；**最终方案见 §3.9（ink 官方 useCursor API）**
4. **选择题交互闭环**：mode 卡死修复（`resolveAsk` 清空 pending 后监听器必须 `setMode(chat)`）+ 通用 `ui_ask` 工具（对话式 A/B 也弹框）+ `gradeAnswer` 字母感知评分（选项存在时字母→选项文本映射，expectedAnswer 字母/文本兼容）+ 系统提示词厘清 mastery_quiz / ui_ask 边界
5. **AskPicker 四连修**：wrapToLines 连续块渲染（消除 wrap-ansi 空格断行拆块）→ maxHeight 行预算窗口化 → **真实根因 = 光标 wrapper 的 CUP 使 ink 增量重绘失步（§3.9）** → LLM 题干内嵌选项剔除（`cleanQuestion` 数据驱动）+ 超预算选项截断（"…"）+ footer truncate

---

## 3. 关键开发经验（按主题分组，本文件核心）

### 3.1 pi 扩展开发（阶段一经验）

1. **网络受限环境**：查库源码配置项，别信镜像环境变量（HF_ENDPOINT 镜像无效）。**Ollama OpenAI 兼容端点是万能解药**（`PI_KNOWLEDGE_EMBEDDING=openai:nomic-embed-text` + base_url 指向 11434）。
2. **交互式工具的返回必须打破 agent 默认预期**：工具返回 `userAnswer` 后 agent 仍按"出题→等回答"思维链走 → 返回 `alreadyAnswered:true` + `nextStep` + 强 instruction；description 写明交互流程。
3. **工具参数 description 是给 agent 看的契约**：与 prompt 职责分离，不重复；过长会被截断（ui.select 长选项用 ui.custom + wrapLines）。
4. **pi-package 打包**：核心包进 peerDependencies、运行时依赖进 dependencies；`keywords:["pi-package"]` + `pi` manifest。
5. **junction 开发闭环**：改代码即生效；悬空 junction 判断用 `Get-Item` 而非 `Test-Path`（悬空链接 Test-Path 返回 False 会误判为不存在而跳过）。
6. **pi 升级不清空扩展**：`~/.pi/agent/` 下扩展/skills/prompts 实测完好。
7. **破坏性删除前先 Test-Path + 备份**（本次误删 30MB chat_history.db 的教训）。

### 3.2 ink + Windows Terminal 输入管线（阶段二精华，踩坑最多）

#### 3.2.1 粘贴
1. **粘贴必须用 ink 官方 `usePaste`**（最痛的一课）：ink 的 input-parser 会**剥离** `\x1b[200~...\x1b[201~` 标记并发出独立 paste 事件；**没有组件注册 usePaste 时**，ink 走 legacy fallback 把含 `\r` 的粘贴内容直接当 input 事件发给所有 useInput——因此**在 useInput 里扫描 `[200~` 标记永远无效**（前两版修复失败根因）。`usePaste` 激活时 ink 自动启用 2004h。
2. **WT 粘贴换行统一为 `\r`**（FilterStringForPaste 把 \n 转 \r），解析时 `\r\n`/`\r` → `\n` 归一。
3. **空粘贴兜底**：WT <1.25 会把纯图片剪贴板表现为空 bracketed paste → 空内容直接返回。

#### 3.2.2 按键
4. **Ctrl+C 失效根因**：ink `render()` 默认 `exitOnCtrlC: true`，会在 useInput 之前吞掉 Ctrl+C。必须 `render(<App/>, { exitOnCtrlC: false })` 后自行处理（输入非空→清空，空→退出）。
5. **Shift+Enter**：WT 发送 `\x1b[13;2u`（CSI-u）→ ink 解析 `key.return && key.shift`；**Ctrl+Enter** → `\x1b[13;5u` → `key.return && key.ctrl`。普通 Enter = `\r` → `key.return`。
6. **未知 CSI 序列**（SGR 鼠标 `\x1b[<...M`、paste 标记等）ink 会作为 input 字符串传给 useInput（key 全 false，且**开头 ESC 被 strip**），用 `input.startsWith("[<")` 等前缀过滤，勿误当字符输入。

### 3.3 CJK 渲染（中文终端专属坑）

7. **ink Text 的 wrap 是单词级（按空格断行）**：无空格中文长行被当"一个超长单词"永不换行 → 横向溢出。解决：**自绘行缓冲**——用 `wrapToLines`（CJK 显示宽度感知、字符级硬切）预切行，每行一个 `<Text wrap="truncate">`。MessageList 与 TextInput 均采用；**估算（countDisplayLines）与渲染行数必须严格一致**。
8. **`❯`（U+276F）是 East Asian Ambiguous 字符**：CJK 终端下渲染 2 列而 ink/string-width 算 1 列 → 光标锚点偏移 1 列。处理：`screenColBase=5`（paddingX1 + ❯2 + 空格1 + 1-based）。
9. **text-delta 流式必须批处理**（30ms flush 合并 setState），否则每 token 一次 reconciler 全树 diff。

### 3.4 WT 鼠标模式（SGR 1000/1002/1006）

10. **Shift 事件被 WT 硬编码拦截**（`ControlInteractivity.cpp:690-699` `if (modifiers.IsShiftPressed()) return false;`）：鼠标模式下 Shift+拖拽走 WT 原生选区，**应用永远收不到** Shift 鼠标事件（v1.8→main 全版本一致，TODO GH#4875 未修）。因此"检测划词暂停动画"不可行（检测不到原生划词）。
11. 开 mouse tracking 后：滚轮以 SGR 事件（64/65）到达应用（替代 1007 转键），需自行处理 wheel → scrollOffset；无修饰键拖拽事件归应用（不再产生 WT 原生选区），应用可自绘选区。
12. **自绘选区坐标映射**：屏幕坐标（1-based）→ 行缓冲坐标：行 `viewStart + (y-1)`，列 `x - 1 - PAD_COLS`（PAD_COLS=2）；`extractSelectionText` **方向感知**（反向拖拽时首行用起点列、末行用终点列，不能全局 min/max）。
13. **闪烁即破坏划词**：任何周期性 React 重渲染（自绘 ▎ 500ms blink、spinner tick）在 WT 下都会清除鼠标选区。结论：自绘闪烁只能"打字期间短暂闪烁 + 闲置常亮"，或完全交给终端硬件光标（硬件光标闪烁是渲染器内部 timer，零写入、不破坏选区）。

### 3.5 IME / 硬件光标

14. **IME 拼音位置跟随硬件光标**（即使 `?25l` 隐藏，WT 的组合窗口仍定位在光标处）。方案：隐藏硬件光标但**每帧锚定到输入框光标行列**（`\x1b[{row};{col}H\x1b[?25l`），自绘 ✏️ 保持可见准确。锚定 effect 的 deps 必须含闪烁状态 `cursorOn`（ink 重绘会移动终端光标）。
15. **布局行号链**（两行状态栏时）：`visibleHeight = rows - inputAreaHeight - 2`；`screenRow = rows - inputAreaHeight`（命令菜单不偏移输入框行号，容器贴底）。
16. **自绘 ✏️ 光标必须"覆盖式"而非"插入式"**：插入式（字符间插 ✏️，2 列宽）使渲染行宽超出排版预算 +2 列 → 触发 ink flex 压缩、行内元素拆行。覆盖式（✏️ 覆盖 caret 处最多 2 显示列 = 1 汉字或 2 半角，闪烁 off 用全角空格 `　` 覆盖同位）保证行宽 ≡ 排版预算。行尾追加时用 `wrap="truncate"` 兜底。

### 3.6 粘贴区块模型（本次 session 主线，opencode 对齐）

17. **opencode 多行粘贴模型（源码级调研结论）**：
    - 双路径：小粘贴（<3 行且 ≤150 字符）→ `insertText` 直接变多行可编辑文本；大粘贴 → 单行占位符 `[Pasted ~N lines]` + extmark（主题 `extmark.paste` = **warning 背景 + bold，唯一带背景色的 extmark**），提交/复制时展开回完整文本（`prompt/part.ts`）。
    - 光标：opencode 无 ✏️，自绘 block 光标（blinking）；占位符 `virtual: true`，光标被 **clamp 到其边界外**（`extmarks.ts`），"光标停在占位符内部"的状态不存在。
    - 中间插入：小文本直插时后文被推后续行是标准编辑器语义（有测试断言）；大粘贴走占位符分支则无此问题。
    - 可抄细节：占位符文本后带空格；Enter=换行 / Meta+Enter=提交。
    - 参考文件：opencode `packages/tui/src/component/prompt/index.tsx`、opentui `packages/core/src/renderables/Textarea.ts`。
18. **parts（段列表）模型设计**：`InputPart = text | block`；`caret = {pi, off}`（part 索引 + 段内偏移，block 段 off ∈ {0,1} = 前/后）。text 段中间插入时拆分为 前后text + block；空 text part 保留零宽锚点段（caret 可停）。
19. **mergeParts 语义**（真 bug 教训）：`parts.map(p=>p.text).join("\n")` 会让**相邻 text part 之间也插换行**（block 删除后必现）。正确：text 段无缝拼接、block 与相邻内容用单个 `\n` 分隔（`!out.endsWith("\n")` 防双换行）。
20. **block 边界插入要合并而非新建**：insertText 在 block 边界（off=0 并入前段、off=1 并入后段），否则产生碎片段；insertBlock 的 before/after 为空时不创建 `{text:""}` 空段；caret 用 blockIndex（考虑 before 跳过）而非盲 `pi+1`。
21. **空数组守卫**：`lastCaret([])` 返回 `{pi:0, off:0}` 但 parts 为空 → 一打字就崩（`next[0].kind` TypeError）。insertText/insertBlock/backspace/deleteForward/moveCaret 全部必须加空数组早退。
22. **共享排版函数是防抖动的根本**：`buildLines(parts, width)` 导出纯函数，渲染与 `estimateInputLines`（App 输入框高度）共用 → 估算 = 实际行数。App 不要另写一套手算。
23. **`\n` 必须按硬换行处理**（换行溢出 bug B 根因）：`displayWidth("\n")` = 0 → 若被当零宽字符塞进当前行，估算 1 行但 ink 渲染真实换行 → 渲染行数 > 估算 → 高度不够溢出 + 光标锚点错位。对齐 `wrapToLines` 语义（split 分段、尾部/连续换行产生空行）。**空行段渲染必须 height={1}** 才占 1 终端行；段 key 用 `pi:offStart:offEnd`（零宽锚点与后续段共享 offStart 会 React key 冲突重复渲染）。
24. **ink flex 压缩会传导**：行宽略超预算时，ink 压缩无 `flexShrink={0}` 的 Box，压缩到行内原子 token（block）时其内部 Text 默认 wrap 在空格处拆行（`[已粘贴 5` / `行]`）。行内原子 token 必须：根 Box `flexShrink={0}` + token Box `flexShrink={0}` + 内部 Text `wrap="truncate"`。

### 3.7 冒烟测试环境（headless 验证 ink 组件的完整套路）

25. **ink 组件级冒烟必须用受控 wrapper**：TextInput 是受控组件（编辑只靠父组件把 onChange 结果回流进 parts prop）。静态 `parts={[]}` 父组件永不重渲染 → 状态永不前进 → 后续断言全部超时。正确做法：
    ```jsx
    function Harness() {
      const [parts, setParts] = useState([]);
      return <TextInput parts={parts} onChange={(p) => { setParts(p); log.push(p); }} ... />;
    }
    ```
26. **fake stdin 必须是真实 Readable 流**：ink App 组件用 readable 流模式读 stdin（`addListener('readable')` + `while((chunk=stdin.read())!==null)`），**不是 `data` 事件**——EventEmitter 模拟无效。且必须提供：`isTTY=true`、`setRawMode`、`setEncoding`、**`ref`/`unref` stub**（`handleSetRawMode` 调 `stdin.ref()`，缺了会 TypeError 且 `attachReadableListener` 永不执行，输入全丢）。render 传 `stdin: null` 会抛 "Raw mode is not supported"。
27. **fake stdout**：真实 Readable + `write` 覆盖收集 + `columns/rows` + `isTTY` + `unref`。
28. **输入序列**：普通字符直接 push 字符串；bracketed paste 用 `\x1b[200~...\x1b[201~`（ink 解析后走 usePaste 通道）；← `\x1b[D`；Enter `\r`；Backspace `\x7f`。
29. **断言节奏**：每个 send 后 `waitFor` 轮询（20ms/次、3s 超时）等 onChangeLog 更新，不要固定 sleep 后立即断言。
30. **渲染一致性验证**：对比 `estimateInputLines` vs 实际渲染非空行数（strip ANSI 后数行），多宽度（80/40/30/26/24/20）矩阵跑，能抓出估算与渲染的一切漂移。

### 3.8 工作流经验

31. **终端交互 bug 先查 WT/ink 源码**（microsoft/terminal 源码 + ink 包源码），比盲改高效一个量级——本 session 多个"改了几版无效"的问题都是源码级定位解决的（Shift 鼠标拦截、paste 标记剥离、readable 流模式）。
32. **用户点名的参考实现必须源码级调研**：opencode 的粘贴占位符方案（extmark + 主题 + clamp）直接决定我们的 v3 重构形态，比拍脑袋设计稳。
33. **npm 装包必须 `--legacy-peer-deps`**（tree-sitter 依赖树 peer 冲突：go 要 0.21.1，python/rust 要 ^0.22.1）。
34. **PowerShell 执行 commit message 含特殊字符**（`\"`、`\x1b`、emoji）会解析失败——用简化消息或单引号。
35. **每个渲染/交互改动配一个可复跑复现脚本**（项目根 `_repro_*.mjs` / `_smoke_*.mjs`），用户报 bug 先复现再改，改完跑全部脚本防回归（本次三个复现脚本分别抓住了 软换行/硬换行/渲染一致性 三类问题）。

### 3.9 ink 渲染机制与光标（阶段三最深坑，决定性教训）

36. **ink 7 增量重绘用相对光标移动**：`log-update.js` 按内部记录的上一帧行数发 `cursorUp(N)`/`eraseLines`，假设真实终端光标停在 ink 上次写入的位置。**任何在帧间移动真实光标的操作（如自写 `\x1b[{r};{c}H` 锚定）都会让下一帧画错行**——真实终端可见（帧错位、行重叠、内容"消失"），headless 复现不了（fake stdout 只收集字节、不解释光标序列，且该包装器只在真实入口 `index.ts`）。
37. **光标定位必须用 ink 官方 API**：`useCursor().setCursorPosition({x,y})`（ink 7.1.1 有，专为 IME 设计）——ink 自己追踪位置并计入重绘（`buildReturnToBottomPrefix` 重绘前退回帧底、`buildCursorSuffix` 帧尾定位；坐标 0-based 相对输出原点，本项目 1-based 屏幕坐标要 -1）。隐藏光标用纯 `?25l` 包装（**隐藏不移动 → 不失步**）。已知 #982 光标 off-by-one 未进 7.1.1。
38. **headless 验证的盲区**：凡是"真实终端才解释"的序列（光标移动、擦除、SUM `?2026`）引发的 bug，fake stdout 全绿 ≠ 真实正常。这类问题要么断言具体 ANSI 序列（如 `\x1b[7G\x1b[?25h` 光标后缀），要么必须真实终端实测。SUM 使错位原子化不闪烁，更难发现。
39. **ink Text 换行是 wrap-ansi（空格断行）**：无空格中文长行不换行（横向溢出），含空格则从空格处拆块（"A) 选项文本"被拆成标签行+文本行，选项看起来"分解为两块"）。**任何需要 CJK 精确换行的渲染（消息/输入框/选择器）一律用自绘 `wrapToLines` 行缓冲** + 每行 `height={1}` + `wrap="truncate"` 兜底。
40. **固定高度容器渲染列表的不变量**：总高度 = chrome（border/margin/padding/footer/窗口提示行，本项目 10-11 行）+ 题目 + 选项 ≤ 可用高度；**选中项无条件包含时必须截断其渲染**（超预算补 "…"），否则溢出重叠相邻行（选项跑到 footer 行）。

### 3.10 交互选择器与 agent 防呆

41. **选项窗口化算法**：行预算 + 选中项为锚（先向后扩展再向前）；题目先截断（"…"）保障选项最少行数；`(showing X of Y)` 提示；行数计数用统一 prefix 宽度（`"> "` 与 `"  "` 同宽，选中/未选中行数一致）。
42. **交互式选项必须走工具**：LLM 纯文本列选项（"• A：…"）永远不会弹框——`ui_ask`（非 mastery 选择题）与 `mastery_quiz`（mastery 测验，`question_type="choice"`+options 弹同一个选择器）边界写进工具描述 + 系统提示词；**题干禁止内嵌选项**（显示层再加数据驱动剔除：与选项值重复的行才删，零误伤，正则启发式会误删 "A) 和 B) 哪个更好" 这类合法行）。
43. **评分防呆**：`gradeAnswer` 加 options 参数——字母（"A"）/前缀（"A: 文本"）/全文三种答案形态都能判（字母→选项文本映射，expectedAnswer 字母或文本兼容）；mastery_quiz 有 options 即视为 choice（自动升级交互路径，即使 LLM 传了 short 类型）。
44. **模式生命周期**：`resolveAsk` 清空 pending 后监听器必须把 mode 切回 chat（否则输入框永不恢复）；ESC 双重用途（取消选择器/双击中断）按 mode 门控。

### 3.11 数学渲染（markdown LaTeX，零依赖）

45. **marked 不认 LaTeX**：`$$...$$` 只是字面文本。零依赖方案：自写 `mathToUnicode` 转换器（`src/cli/tui/math.ts`，覆盖分式（含嵌套）/希腊字母/运算符/关系符/上下标 Unicode 映射/重音（组合字符）/`\left\right` 剥壳/矩阵环境/`\\`→换行），在 marked **词法分析之前**用占位符提取数学（`\u0001<idx>\u0002`），`pushText` 处替换为 `markdownMath` 主题色字符。
46. **提取顺序与保护**：代码围栏 ` ``` ` 和行内代码 `` ` `` 里的 `$` 必须先替换为受保护占位符再提取数学（否则 `$` 被误判）；行内 `$...$` 用启发式（内容含 `\命令`/`_`/`^`/`{}` 才算数学——"$5 and $10" 保持字面），块级 `$$...$$` 无条件转换；**未闭合 `$$`（流式中途）也按数学转换**，避免闪烁字面 `$$`（同 trimPartialClosingFences 哲学）。
47. **组合字符必须并入前一格**：`\bar{x}` → `x`+U+0304 等重音是零宽组合标记，若作为独立 StyledChar，字符级 wrap 会把 base 和 accent 切到两行。pushText 遇组合字符要追加到上一个 cell（`isCombiningChar`）。
48. **转换器防呆**：未知命令原样保留（宁可不转换也不丢内容）；数学模式空白语义——脚本（`_{...}`/`^{...}`）内空白丢弃（`_{i \in C}`→ᵢ∈C）、分隔符/标签后空白跳过；无 Unicode 上标的字符（大写字母等）保留字面（`^K` 在补 ᴷ 前显示 `K`，宁可朴素不错位）。

### 3.12 评分与滚动（后续修复）

49. **选择题判分必须支持 "expected 是 prose"**：LLM 常把 `expected_answer` 传成自由文本（"K-means 属于无监督学习"）而非选项字母——旧代码只支持 expected=单字母（字母比对）或 userText 精确/语义比对，长选项句 vs 短 expected 短语语义 <0.85 → **选对的被误判**（真实事故：K-means 首题选 B 判错）。修复：expected 为 prose 时先精确匹配选项文本（零嵌入），再语义 argmax（≥0.6 下限）映射到选项字母，与 userLetter 比对——这才是"expected 是其中一个选项"的正确语义。预防层：mastery_quiz 描述要求 choice 题 expected_answer 传**字母**。
50. **滚动门控只挡按键冲突，不挡处理中/ask**：滚轮/PgUp/PgDn 的 isActive 曾写死 `mode==="chat" && !isProcessing` → AI thinking 时和 ui-ask 面板弹出时**页面锁死**（真实事故）。滚动查看历史在处理中/选择题弹出时是合法需求；AskPicker 只消费 ↑↓/Enter/ESC，与滚动无冲突 → 门控放宽为 `chat || ask`。
51. **先保存再置空**：错误提示 `Incorrect. Expected: "..."` 曾在 `topic.pendingQuestion = null` **之后**读 expectedAnswer → 永远显示 `(unknown)`。置空前先存局部副本。

### 3.13 输入框窗口化滚动（高度预算溢出修复）

52. **高度被 clamp 时内容仍会全部渲染**（真实事故：用户"输入框第七行开始溢出"）：App 预算 `inputAreaHeight = min(MAX=8, 2+inputLines)`，但 TextInput 无条件渲染所有 `buildLines` 行（每行 `height={1}`）→ 内容行 ≥7 时预算封顶 8、实际渲染 9+ 行，**ink Box 默认 `overflow: visible`（Box.js）**，超出的行直接画出框外压住状态栏/消息区。根因不是 ink 布局 bug，是"渲染行数 vs 高度预算"失配。
53. **窗口化三处行号必须联动**：修复 = TextInput 加 `maxLines` prop——`viewTop = clamp(caretLoc.row-(maxLines-1), 0, lines.length-maxLines)`（caret 行恒在窗口最后一行，Home/End/↑↓ 移动 caret 即滚动窗口），渲染只画 `lines.slice(viewTop, viewTop+maxLines)`。三处映射同步改：① 渲染循环的 caret 判定用**全量行号** `bufRow = viewTop+r`；② 光标锚定 `setCursorPosition` 用**窗口内行号** `screenRow + caretLoc.row - viewTop`（否则 IME 定位偏到窗口外）；③ 选区提取 `extractInputSelectionText` 加 viewTop/maxLines 参数，屏幕行 y → buffer 行 `viewTop+(y-screenRow)`，`lastRow = screenRow + min(lines.length, maxLines) - 1`。App 侧：`visibleInputLines = min(inputLines, MAX-2)`、`viewportRef`（useRef）由 TextInput 每帧写入当前 viewTop，鼠标释放时提取选区用 `inputViewportRef.current`。
54. **headless 断言小心 React 渲染时机**：Home 键只触发 TextInput 内部 setState → 父组件（Harness）不重渲染 → 在父组件 `useEffect` 里读 `viewportRef.current` 会读到**旧值**。正确做法：viewportRef 用**访问器对象**（`{ get current(), set current(v){同步外部变量} }`）替代 `useRef`，TextInput 每次渲染写 ref 即实时同步。窗口化断言：输入 >maxLines 行内容后数渲染非空行数 ≤ maxLines、caret 在末尾时 viewTop = lines.length-maxLines、Home 后 viewTop=0 且首行（用独特前缀如 `X` 行区分窗口位置）重新可见。

### 3.14 未完成选择题的会话恢复（/continue 重现 ui-ask）

55. **"未完成的选择题"在 JSONL 里的真实形态**：选择题弹出时，assistant 消息（含 ui_ask / mastery_quiz 的 toolCall）在 `message_end` 事件时**已持久化**（agent-harness `handleAgentEvent` → `session.appendMessage`），但 toolResult **从未写入**（ctx.ask 的 Promise 挂起，用户退出进程）。恢复会话后：① `sessionEntriesToMessages` 只提取 text，toolCall-only 消息不显示 → 用户看到"记录消失"；② 上下文尾部是 `assistant(toolCall) 无 toolResult` → LLM API 拒绝该序列，后续对话直接报错。检测要点：**最后一条 message entry 必须是 assistant 且其最后一个交互 toolCall（ui_ask/mastery_quiz 带 options）没有对应 toolResult**——有 toolResult / 尾部是 user / 非交互工具都不算。
56. **恢复链路**（`src/cli/tui/resume.ts` + `ask.ts` 的 `restoreAsk`）：`findUnfinishedAskToolCall(branch)` 纯函数检测 → `restoreAsk(question, options, onResolve)` 复用**同一个** pendingAsk/AskPicker 机制（listeners 通知 App 切 ask 模式）→ 用户作答后 `buildResumedToolResult` 合成工具本该返回的 toolResult（mastery_quiz 用 alreadyAnswered + nextStep 指向 mastery_grade；ui_ask 用 answer/cancelled 语义）→ `harness.appendMessage(toolResult)` 写回会话 → **必须立即 `harness.prompt(RESUME_PROMPT_TEXT)` 驱动 agent 继续**（教训：第一版只写回 toolResult 并提示"继续输入以继续"，用户实测"选择后 agent 没反应"——agent 不会自动醒来，必须手动再触发一轮；内部 prompt 消息带 `[deeptutor-resume] ` 标记，history.ts 的 `sessionEntriesToMessages` 用 `isResumePromptMessage` 过滤，不污染历史/预览）。`maybeResumeUnfinishedAsk` 挂在会话加载后（SessionPicker onSelect）+ `--session` 启动路径（mount effect 依赖 `runtime.session`）。
57. **mastery 恢复的额外保底**：mastery_quiz 在弹出前已 `writeMastery` 持久化 `topic.pendingQuestion`，所以恢复后即使不依赖 toolResult 细节，mastery_grade 也能从磁盘读到 expectedAnswer——恢复只补 toolResult 契约，不重建题目状态。

---

## 4. 失误记录（避免重蹈）

1. 误删 30MB chat_history.db（破坏性删除前未备份）→ 先 Test-Path + 备份。
2. 粘贴修复前两版（块级解析、useInput 扫标记）无效——未先查 ink 源码；usePaste 才是正解。
3. 冒烟脚本首版静态 props 渲染受控组件 → 状态不前进、断言全超时；受控 wrapper 才是正解。
4. 复现脚本 render 忘传 fake stdin → "Raw mode is not supported" 干扰排查。
5. 换行溢出第一轮只修了软换行（✏️ 撑宽 + flex 压缩），漏了 `\n` 硬换行路径（用户 Ctrl+Enter 后必现）→ 用户"问题没变"；根因要按用户实际按键路径穷举。
6. **3 轮选择器修复（窗口化/高度/预算）headless 全绿却无效**——真根因是底层光标失步（§3.9），headless 无法暴露；3 次修复无效就该质疑架构层并查渲染机制/外部知识，而不是继续在组件层打补丁。
7. **光标锚定用裸 CUP 追加写 → ink 相对重绘失步**（帧错位、选项"消失"）。同 write 追加方案当时修好了 IME 却埋下了更大的地雷；最终必须改用 ink 官方 `useCursor` API。
8. 系统提示词"给选项一律用 ui_ask"过宽，把 mastery 测验也带偏（ui_ask 结果与 mastery_grade 不联通导致误判）→ 工具边界描述要精确：mastery 题目必须走 mastery_quiz。
9. PowerShell 管道会打乱 UTF-8 显示（`�?` 伪影），帧转储/断言用 JSON.stringify 或 ASCII 安全子串；`git diff` 对未跟踪文件显示为空（`??` 状态），核对文件改动用 rg 直接搜内容。
10. **mastery 评分修 3 轮 headless 全绿仍误判**——根因是 LLM 把 expected_answer 传成 prose 而非字母（§3.12-49），评分逻辑只覆盖"字母/精确/语义"形态组合，缺 expected→选项字母映射；教训：LLM 工具参数形态不可控，评分函数必须覆盖所有形态，不能假设 agent 遵守描述。
11. **光标偏高一行修了自家坐标转换 3 轮无效**——实为 ink #982（§3.9-37 早已记录"已知 #982"但没第一时间查实）：全屏帧（根 Box height={rows}，无尾随换行）时 buildCursorSuffix 的 `moveUp = visibleLineCount - y` 偏大 1，硬件光标落在请求行**上方一行**，IME 组合窗口（拼音）随之偏高。教训：已知上游 bug 列表在症状复现时要**第一时间查实**（本次 librarian 查证 #982 即根因），而不是先改自家代码。

---

## 5. 验证与环境备忘

- 运行：`npm run dev`（或 build 后 `node dist/index.js`）；pwsh + Windows Terminal
- 构建：`npm run build`（tsc，必须 0 错误）
- 冒烟/复现脚本（项目根）：`_smoke_parts.mjs`（22/22：交互+窗口化滚动）、`_smoke_rewind.mjs`（19/19）、`_smoke_select.mjs`（13/13 划词）、`_smoke_anchor.mjs`（5/5 ink 光标后缀 + #982 全屏补偿）、`_smoke_ask.mjs`（51/51：ask 模块/ui_ask 工具/字母评分+prose expected 映射/AskPicker 渲染+窗口化+截断）、`_smoke_math.mjs`（33/33：mathToUnicode 转换/extractMath 代码保护/renderMarkdown 集成）、`_smoke_resume.mjs`（14/14：未完成选择题会话恢复——findUnfinishedAskToolCall 检测/restoreAsk 弹回/合成 toolResult/RESUME_PROMPT_TEXT 自动驱动继续 + isResumePromptMessage 过滤）；复现脚本 `_repro_height.mjs`（软换行）、`_repro_nl_height.mjs`（硬换行）、`_repro_askpick.mjs`（选项拆块）、`_repro_4opts.mjs`（选项溢出）、`_repro_edge.mjs`（矮终端+滚动）、`_repro_cursor982.mjs`（ink #982 全屏 off-by-one）
- 数据：`~/.deeptutor/`（sessions jsonl / kbs / knowledge sqlite / auth.json）
- 状态栏两行：第 1 行 `[deeptutor-lite] @ provider | KB: xxx` + 模型/会话；第 2 行 `拖拽选中文本，松开即复制 | 双击ESC中断AI回答 | CTRL+C 清空输入框/退出程序`
- 快捷键现状：Enter 提交 / Ctrl+Enter 换行 / ↑↓ 光标跨行（菜单/选择器打开时归它们）/ PgUp/PgDn + 滚轮 滚动 / Ctrl+C 先清空再退出 / **双击 ESC 中断回答（400ms 窗口，仅处理中有效）** / **/rewind 回退历史对话（回退到 user prompt 自动填回输入框）** / 无修饰键拖拽 = 自绘选区复制（消息区+输入框全覆盖）/ Shift+拖拽 = WT 原生选区
- 环境变量（User 级）：`BRAVE_API_KEY`、`PI_KNOWLEDGE_EMBEDDING=openai:nomic-embed-text`、`PI_KNOWLEDGE_EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1`

---

## 6. 当前状态与待办（截至 2026-08-07）

### 已完成（阶段三 + 后续修复，本 session 收尾 commit）
- /rewind 回退（navigateTree 非破坏回退 + RewindPicker + user prompt 还原输入框）
- 双击 ESC 中断（esc.ts 400ms 窗口 + harness.abort()）
- 划词复制全覆盖（消息区所有行类型 + 输入框 + block/选区列基准）
- IME 拼音定位（ink useCursor API + ?25l 纯隐藏包装，不再裸 CUP 锚定）
- ui_ask 工具 + mastery 字母感知评分 + options 自动升级 choice + 提示词工具边界
- AskPicker：wrapToLines 连续块 / maxHeight 行预算窗口化 / 题干选项剔除（cleanQuestion）/ 超预算选项截断（"…"）/ footer truncate
- 状态栏第二行文案更新
- 滚动锁死修复：滚轮/PgUp/PgDn 门控放宽（chat||ask，处理中可回看历史）
- 输入框窗口化滚动（修复"第七行溢出"）：TextInput maxLines + viewTop + viewportRef 三处行号联动（§3.13-52/53/54）
- 未完成选择题恢复：/continue 或 --session 后重现 ui-ask（resume.ts 检测 + restoreAsk + 合成 toolResult 写回会话 + RESUME_PROMPT_TEXT 自动驱动 agent 继续，§3.14-55/56/57）
- mastery 评分修复：expected 为 prose 时映射到选项字母（精确→语义 argmax）+ Expected 提示修复 + 描述要求传字母
- LaTeX 数学渲染（math.ts 转换器 + markdownMath 主题 + extractMath 代码保护 + 流式未闭合处理）
- ink #982 全屏 off-by-one 补偿（TextInput 发布 y+1，_smoke_anchor Part C 固化断言）
- AGENTS.md 本 session 总结（3.11/3.12 新小节 + 失误 10/11 + §5 更新）

### 待办
1. **[用户实测]** 完整重启后验证：选择题全流程（弹出/滚动/题干无选项/不重叠 footer）、IME 拼音紧贴 ✏️（#982 补偿后）、双击 ESC、/rewind 输入框还原、划词覆盖输入框、LaTeX 公式渲染（`$$ s_i = \frac{b_i - a_i}{\max(a_i, b_i)} $$` → 紫色 Unicode）
2. 历史待办（8-03 遗留）：安装方式 `pi install git:github.com/leonyvon/deeptutor-lite` 的最终验证；mastery round budget + 上下文窗口护栏（可选）
