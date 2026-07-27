import { createRequire } from 'node:module'
import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const loadCanonicalScheduleProducts = (count) => {
  const products = JSON.parse(readFileSync(path.join(rootDir, 'src/mock/data/finishedProducts.json'), 'utf8'))
  const selected = products.filter((item) => (
    item
    && typeof item.productId === 'string'
    && typeof item.programCode === 'string'
    && typeof item.title === 'string'
    && item.duration === 1800
  )).slice(0, count)
  if (selected.length < count) {
    throw new Error(`data_fixture_missing: expected ${count} canonical 30-minute finished products, got ${selected.length}`)
  }
  return selected
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const goal37LogPath = path.join(rootDir, 'goal37-run.log')
const goal37Log = (message) => {
  const line = `[${new Date().toISOString()}] ${message}\n`
  try {
    appendFileSync(goal37LogPath, line, 'utf8')
  } catch {
    // ignore
  }
}

const resolvePlaywright = async () => {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE_PATH,
    'playwright',
    path.join(os.homedir(), 'AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright'),
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch {
      // Try the next known installation path.
    }
  }

  throw new Error('Playwright is not available. Install playwright or set PLAYWRIGHT_MODULE_PATH.')
}

const resolveChromiumExecutable = () => {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe'),
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate))
}

const fetchOk = async (url) => {
  try {
    const response = await fetch(url, { method: 'GET' })
    return response.ok
  } catch {
    return false
  }
}

const waitForServer = async (url, timeoutMs = 30_000) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await fetchOk(url)) return true
    await wait(500)
  }
  return false
}

const startDevServer = async (port, options = {}) => {
  if (options.reuseExisting) {
    const url = `http://127.0.0.1:${port}/`
    if (await waitForServer(url, 1_000)) {
      return { url, stop: async () => undefined, reused: true }
    }
  }

  let selectedPort = port
  while (await waitForServer(`http://127.0.0.1:${selectedPort}/`, 400)) {
    selectedPort += 1
    if (selectedPort > port + 20) {
      throw new Error(`No available foreground browser test port from ${port} to ${port + 20}.`)
    }
  }

  const url = `http://127.0.0.1:${selectedPort}/`
  if (options.reuseExisting && await waitForServer(url, 1_000)) {
    return { url, stop: async () => undefined, reused: true }
  }

  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run dev -- --host 127.0.0.1 --port ${selectedPort}`]
    : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(selectedPort)]
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      VITE_AGENT_RUNTIME_MODE: 'local',
    },
  })

  let recentOutput = ''
  child.stdout.on('data', (chunk) => {
    recentOutput = `${recentOutput}${chunk.toString()}`.slice(-4000)
  })
  child.stderr.on('data', (chunk) => {
    recentOutput = `${recentOutput}${chunk.toString()}`.slice(-4000)
  })

  const ready = await waitForServer(url, 40_000)
  if (!ready) {
    child.kill()
    throw new Error(`Vite dev server did not start in time.\n${recentOutput}`)
  }

  return {
    url,
    reused: false,
    stop: async () => {
      if (!child.killed) {
        if (process.platform === 'win32') {
          await new Promise((resolve) => {
            const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
              stdio: 'ignore',
            })
            killer.on('close', resolve)
            killer.on('error', resolve)
          })
        } else {
          child.kill()
        }
      }
      await wait(250)
    },
  }
}

const plannerResponse = (value) => JSON.stringify(value)

const installBrowserLlmMock = async (page) => {
  await page.addInitScript(() => {
    const plannerResponse = (value) => JSON.stringify(value)
    const formalReactTask = (objective, queries = []) => ({
      objective,
      maxTurns: 3,
      batchSize: 2,
      stopCondition: '完成候选与约束核验后逐批决定，不能决定时停止并保留 checkpoint',
      nextActions: [
        { type: 'research_check', purpose: 'candidate_precheck', queries },
        { type: 'validate' },
      ],
    })
    const extractUserInput = (messages) => {
      const joined = messages.map((message) => message.content).join('\n')
      const userJson = [...joined.matchAll(/"userInput"\s*:\s*"([^"]*)"/g)].at(-1)?.[1]
      return userJson ? userJson.replace(/\\u([\dA-Fa-f]{4})/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16))) : joined
    }

    /**
     * 从前台上下文包 prompt 中探测当前是否存在指定类型的待确认 review。
     * 用于处理“确认重新编排”“确认删除”等依赖 pending 状态的简短回复。
     */
    const hasPendingReview = (promptText, kinds) => {
      try {
        const pendingMatch = promptText.match(/"pendingReview"\s*:\s*(\{[\s\S]*?\})/)
        if (!pendingMatch) return false
        const pending = JSON.parse(pendingMatch[1].replace(/,\s*\}/g, '}'))
        return kinds.includes(pending.kind)
      } catch {
        return false
      }
    }

    window.__goal37LlmCalls = []
    window.__AIBIANDAN_RUNTIME_TRACE__ = []
    window.__goal38FailureOnce = {}
    window.__AIBIANDAN_LLM_MOCK__ = async ({ messages, options }) => {
      const userInput = extractUserInput(messages)
      const promptText = messages.map((message) => message.content).join('\n')
      window.__goal37LlmCalls.push({
        traceLabel: options?.traceLabel ?? 'chat',
        userInput,
        at: Date.now(),
        returned: false,
      })
      const markReturn = (response) => {
        const lastCall = window.__goal37LlmCalls[window.__goal37LlmCalls.length - 1]
        if (lastCall) {
          lastCall.returned = true
          lastCall.returnedAt = Date.now()
          lastCall.responsePreview = typeof response === 'string' ? response.slice(0, 300) : JSON.stringify(response).slice(0, 300)
        }
        return response
      }

      if (userInput.includes('模拟模型失败')) {
        throw new Error('goal37 simulated model failure')
      }

      if (userInput.includes('模拟一次失败后继续')) {
        const key = 'recover-on-retry'
        if (!window.__goal38FailureOnce[key]) {
          window.__goal38FailureOnce[key] = true
          throw new Error('goal38 simulated transient failure')
        }
        return markReturn(plannerResponse({
          actions: [{
            type: 'prepare_layout_draft',
            rotationDurationSeconds: 3600,
            semanticLabel: '失败恢复后的轮播草案',
            segments: [
              { start: '00:00:00', end: '01:00:00', semanticLabel: '失败恢复后生成的草案', programTypeHint: 'news_magazine' },
            ],
          }],
          assistantReplyDraft: '这次已经恢复，我先把需求整理成草案；确认前不会写入正式轮播单。',
          reasoning: '用户要求重试上一条失败的轮播草案请求。',
        }))
      }

      if (options?.traceLabel === 'agent_react_synthesize') {
        return markReturn('我先查了当前草案段和素材库，静安寺、商圈现场这类素材比较贴近这个方向。能定位到草案段时我会直接更新草案；正式播单不会被写入。')
      }

      if (options?.traceLabel === 'formal_orchestration_decide' && promptText.includes('ReAct审批测试')) {
        window.__goal37FormalApprovalDecideCount = (window.__goal37FormalApprovalDecideCount ?? 0) + 1
        if (window.__goal37FormalApprovalDecideCount === 1) {
          return markReturn(plannerResponse({
            kind: 'continue',
            reason: '素材和目标节目已经核验，删除属于敏感写入，先等待编排员明确确认。',
            nextActions: [{
              type: 'atomic_command',
              intent: 'delete',
              targetItemId: 'react-delete-target',
              targetProgramName: '待删除测试节目',
              mutationPolicy: 'pending_only',
            }],
          }))
        }
        return markReturn(plannerResponse({
          kind: 'complete',
          reason: '已按编排员的明确确认完成删除并复核现场。',
        }))
      }

      if (userInput.includes('执行ReAct审批测试')) {
        return markReturn(plannerResponse({
          mode: 'react',
          actions: [{
            type: 'formal_orchestration', mode: 'partial_generate', taskKind: 'local_refill',
            useLayoutDraft: true, confirmExistingRebuild: true,
          }],
          reactTask: {
            objective: 'ReAct审批测试：核验后删除指定节目',
            maxTurns: 3,
            batchSize: 2,
            stopCondition: '删除经用户明确确认并完成现场复核后结束',
            nextActions: [{
              type: 'research_check',
              purpose: 'candidate_precheck',
              semanticLabel: '待删除测试节目',
              queries: ['待删除测试节目'],
            }],
          },
          assistantReplyDraft: '我先核验目标节目，涉及删除时会停下来等你明确确认。',
          reasoning: '浏览器回归验证正式 ReAct 审批中断和显式恢复。',
        }))
      }

      if (userInput.includes('继续') && promptText.includes('activeReactTask') && promptText.includes('世界杯亚洲球队素材')) {
        return markReturn(plannerResponse({
          mode: 'react',
          actions: [],
          reactTask: {
            objective: '继续核验世界杯亚洲球队素材后更新草案方向',
            maxTurns: 3,
            batchSize: 2,
            stopCondition: '素材方向明确后直接更新草案，不直接写正式播单',
            nextActions: [{
              type: 'research_check',
              purpose: 'candidate_precheck',
              targetSegmentIndex: 1,
              semanticLabel: '世界杯亚洲球队素材',
              programTypeHint: 'documentary',
              queries: ['世界杯 亚洲球队 介绍', '中国队 日本队 韩国队 足球介绍'],
            }],
          },
          assistantReplyDraft: '我接着上一轮任务先核素材库；canonical 数据已具备，可定位到草案段后更新，不会写入正式轮播单。',
          reasoning: '前台上下文里存在 activeReactTask，用户说继续，应续跑查证任务；候选事实来自 canonical 数据源。',
        }))
      }

      if (options?.traceLabel === 'playlist.readonly_analysis') {
        return markReturn('我看了一下当前编单：新闻和专题内容都有，整体节奏比较稳。现在只是分析，没有改动播单。')
      }

      if (options?.traceLabel === 'playlist.optimization_suggestion') {
        return markReturn('可以把同类新闻内容稍微分散，把专题节目放在更适合停留观看的时段。要不要我把这个建议整理成草案调整方向？')
      }

      if (userInput === '上午以新闻和民生内容为主') {
        return markReturn(plannerResponse({
          actions: [{ type: 'clarify', question: '我记下了这个编排目标。你希望创建电视播单还是轮播单？' }],
          assistantReplyDraft: '我记下了这个编排目标。你希望创建电视播单还是轮播单？',
          reasoning: '用户先说明编排目标，但尚未指定播单类型。',
        }))
      }

      if (userInput === '就按刚才讨论的目标，新建电视播单，然后按当前版面开始全天编排') {
        return markReturn(plannerResponse({
          mode: 'react',
          actions: [
            { type: 'create_playlist', playlistType: 'tv' },
            { type: 'formal_orchestration', mode: 'full_generate', taskKind: 'full_day', useLayoutDraft: true },
          ],
          reactTask: {
            objective: '创建电视播单后按当前版面完成全天编排',
            maxTurns: 4,
            batchSize: 4,
            stopCondition: '全天编排完成或暴露不可恢复问题',
            nextActions: [
              { type: 'create_playlist', playlistType: 'tv' },
              { type: 'formal_orchestration', mode: 'full_generate', taskKind: 'full_day', useLayoutDraft: true },
            ],
          },
          assistantReplyDraft: '我先创建电视播单，再根据创建后的版面现场继续编排。',
          reasoning: '正式编排依赖新播单工作区，需要逐轮观察。',
        }))
      }

      if (userInput === '请先整理版面草案再新建电视播单') {
        return markReturn(plannerResponse({
          actions: [],
          assistantReplyDraft: '我先整理版面草案，再创建电视播单。',
          reasoning: '模型没有返回合法创建动作。',
        }))
      }

      if (userInput === '新建电视播单' || userInput === '新建轮播单') {
        const playlistType = userInput.includes('轮播') ? 'rotation' : 'tv'
        return markReturn(plannerResponse({
          actions: [{
            type: 'create_playlist',
            playlistType,
            ...(playlistType === 'rotation' ? { rotationStrategy: 'content_match' } : {}),
          }],
          assistantReplyDraft: playlistType === 'rotation' ? '我先新建一张轮播单。' : '我先新建一张电视播单。',
          reasoning: '用户明确要求创建新的播单工作区。',
        }))
      }

      if (userInput.includes('看东方后继续插入一个看东方节目')) {
        if (options?.traceLabel === 'agent.intent_interpreter') {
          return markReturn(plannerResponse({
            intent: 'insert',
            confidence: 0.94,
            pendingAction: 'continue_pending',
            slots: {
              targetTime: '01:00:00',
              programHint: '看东方',
            },
            searchAlternatives: ['看东方', '东方卫视 看东方'],
            assistantFeedback: '我会接在当前轮播单里已排的《看东方》后面继续插入，写入前先让你确认候选。',
            reasoning: '轮播单当前已有看东方节目，用户要求接在它后面继续插入同栏目节目。',
          }))
        }
        return markReturn(plannerResponse({
          actions: [{ type: 'atomic_command' }],
          assistantReplyDraft: '我会接在当前轮播单里已排的《看东方》后面继续插入，写入前先让你确认候选。',
          reasoning: '用户提出基于当前轮播队列锚点的插入。',
        }))
      }

      if (userInput.includes('继续插入一个看东方节目')) {
        if (options?.traceLabel === 'agent.intent_interpreter') {
          return markReturn(plannerResponse({
            intent: 'insert',
            confidence: 0.9,
            slots: {
              programHint: '看东方',
            },
            searchAlternatives: ['看东方', '东方卫视 看东方'],
            assistantFeedback: '我知道你想继续插入《看东方》，还需要确认插在队列的哪个位置。',
            reasoning: '用户给了节目线索，但没有给轮播队列位置。',
          }))
        }
        return markReturn(plannerResponse({
          actions: [{ type: 'atomic_command' }],
          assistantReplyDraft: '我知道你想继续插入《看东方》，还需要确认插在队列的哪个位置。',
          reasoning: '用户提出插入节目但缺少位置。',
        }))
      }

      if (userInput === '插入看东方') {
        if (options?.traceLabel === 'agent.intent_interpreter') {
          return markReturn(plannerResponse({
            intent: 'insert',
            confidence: 0.9,
            slots: {
              programHint: '看东方',
            },
            searchAlternatives: ['看东方', '东方卫视 看东方'],
            assistantFeedback: '我知道你想插入《看东方》，还需要确认插在队列的哪个位置。',
            reasoning: '用户给了节目线索，但没有给轮播队列位置。',
          }))
        }
        return markReturn(plannerResponse({
          actions: [{ type: 'atomic_command' }],
          assistantReplyDraft: '我知道你想插入《看东方》，还需要确认插在队列的哪个位置。',
          reasoning: '用户提出插入节目但缺少位置。',
        }))
      }

      if (userInput.includes('换成1点插入')) {
        if (options?.traceLabel === 'agent.intent_interpreter') {
          return markReturn(plannerResponse({
            intent: 'insert',
            confidence: 0.92,
            pendingAction: promptText.includes('pendingTask') ? 'continue_pending' : undefined,
            slots: {
              targetTime: '01:00:00',
            },
            assistantFeedback: '我把插入位置改到轮播队列的1点位置，节目线索继续沿用《看东方》。',
            reasoning: '用户在补充上一条插入任务的位置，应该沿用上一轮节目线索。',
          }))
        }
        return markReturn(plannerResponse({
          actions: [{ type: 'atomic_command' }],
          assistantReplyDraft: '我把插入位置改到轮播队列的1点位置，节目线索继续沿用《看东方》。',
          reasoning: '用户在补充上一条插入任务的位置。',
        }))
      }

      if (userInput.includes('就在已插入的看东方节目后')) {
        if (options?.traceLabel === 'agent.intent_interpreter') {
          return markReturn(plannerResponse({
            intent: 'insert',
            confidence: 0.92,
            pendingAction: 'continue_pending',
            slots: {
              targetTime: '01:00:00',
            },
            assistantFeedback: '我会接在当前轮播单里已排的《看东方》后面继续插入。',
            reasoning: '用户在补充上一条待确认插入的位置，沿用上一轮节目线索。',
          }))
        }
        return markReturn(plannerResponse({
          actions: [{ type: 'atomic_command' }],
          assistantReplyDraft: '我会接在当前轮播单里已排的《看东方》后面继续插入。',
          reasoning: '用户在补充上一条插入任务的位置。',
        }))
      }

      if (userInput.includes('1点的看东方向后移动1小时')) {
        if (options?.traceLabel === 'agent.intent_interpreter') {
          return markReturn(plannerResponse({
            intent: 'move',
            confidence: 0.93,
            slots: {
              targetTime: '13:00:00',
              targetProgramName: '看东方',
              offsetSeconds: 3600,
              direction: 'forward',
            },
            assistantFeedback: '我会按当前轮播队列里的《看东方》这一条，向后顺延1小时。',
            reasoning: '轮播单里1点按相对队列位置理解，同时用户给出了节目名，应按节目名定位。',
          }))
        }
        return markReturn(plannerResponse({
          actions: [{ type: 'atomic_command' }],
          assistantReplyDraft: '我会按当前轮播队列里的《看东方》这一条，向后顺延1小时。',
          reasoning: '用户要求移动当前轮播队列中的看东方节目。',
        }))
      }

      if (userInput.includes('9点插入看东方')) {
        if (options?.traceLabel === 'agent.intent_interpreter') {
          return markReturn(plannerResponse({
            intent: 'insert',
            confidence: 0.95,
            slots: {
              targetTime: '09:00:00',
              programHint: '看东方',
            },
            searchAlternatives: ['看东方', '东方卫视 看东方', '新闻杂志 看东方'],
            assistantFeedback: '我理解你要在9点插入《看东方》，我会先核对候选，确认后再写入播单。',
            reasoning: '用户给出了插入时间和节目线索。',
          }))
        }
        if (options?.traceLabel === 'agent.candidate_judge') {
          return markReturn(JSON.stringify({
            candidateId: '',
            reasoning: '《看东方》候选有多个期数且无顺播基线，需要用户确认具体期数或版本。',
            considerations: ['候选期数不唯一', '无顺播基线'],
            decisionType: 'needs_clarification',
          }))
        }
        return markReturn(plannerResponse({
          actions: [{ type: 'atomic_command' }],
          assistantReplyDraft: '我理解你要在9点插入《看东方》，我会先核对候选，确认后再写入播单。',
          reasoning: '用户提出单条插入节目，交给原子能力执行。',
        }))
      }

      if (userInput.includes('9点插入电视剧生命树第5集')) {
        return markReturn(plannerResponse({
          actions: [{ type: 'atomic_command' }],
          assistantReplyDraft: '我理解你要在9点插入《生命树》第5集，我会先从 canonical 节目库核对候选，符合规则后再处理。',
          reasoning: '用户给出了明确时间和具体剧集，属于精准原子插入，不需要 ReAct；候选事实由 canonical 数据源提供。',
        }))
      }

      if (userInput.includes('23:30之后帮我再排入个节目')) {
        if (options?.traceLabel === 'agent.intent_interpreter') {
          return markReturn(plannerResponse({
            intent: 'insert',
            confidence: 0.8,
            slots: {
              targetTime: '23:30:00',
            },
            assistantFeedback: '我理解你想在23:30之后补一个节目，但还缺节目方向。你可以说具体节目名，也可以让我按晚间时段推荐。',
            reasoning: '用户给出了电视播单里的插入位置，但没有给出节目线索。',
          }))
        }
        if (options?.traceLabel === 'atomic_intent') {
          return markReturn(JSON.stringify({
            type: 'insert',
            confidence: 0.82,
            reasoning: '用户给出了插入位置，但节目方向还不明确。',
          }))
        }
        if (options?.traceLabel === 'atomic_insert_params') {
          return markReturn(JSON.stringify({
            targetTime: '23:30:00',
          }))
        }
        return markReturn(plannerResponse({
          actions: [{ type: 'atomic_command' }],
          assistantReplyDraft: '我先按23:30之后这个正式播单位置理解，但还需要节目方向；你也可以让我推荐。',
          reasoning: '用户提出正式播单插入，但节目线索缺失。',
        }))
      }

      if (userInput.includes('你可以推荐') && promptText.includes('23:30')) {
        if (options?.traceLabel === 'agent.intent_interpreter') {
          return markReturn(plannerResponse({
            intent: 'insert',
            confidence: 0.88,
            pendingAction: promptText.includes('pendingTask') ? 'continue_pending' : undefined,
            slots: {
              targetTime: '23:30:00',
              programHint: '今晚',
            },
            searchAlternatives: ['今晚 晚间观察', '晚间专题 观察', '夜间 新闻评论'],
            assistantFeedback: '我按当前电视播单的23:30位置继续推荐。这个时段更适合晚间观察或新闻评论类节目，我先查《今晚》方向。',
            reasoning: '用户回复“你可以推荐”，应沿用上一轮23:30正式播单插入位置，并补入晚间节目推荐方向。',
          }))
        }
        if (options?.traceLabel === 'atomic_intent') {
          return markReturn(JSON.stringify({
            type: 'insert',
            confidence: 0.9,
            reasoning: '用户是在继续上一条23:30之后插入节目请求，并要求系统推荐。',
          }))
        }
        if (options?.traceLabel === 'atomic_insert_params') {
          return markReturn(JSON.stringify({
            targetTime: '23:30:00',
            programName: '今晚',
            rawProgramText: '今晚',
            semanticLabel: '晚间观察',
            programTypeHint: 'news_commentary',
          }))
        }
        return markReturn(plannerResponse({
          actions: [{ type: 'atomic_command' }],
          assistantReplyDraft: '我会沿用刚才的23:30之后位置，按晚间观察方向查节目候选，不会改草案。',
          reasoning: '用户要求系统推荐，应继续上一轮正式播单插入任务。',
        }))
      }

      if (userInput.includes('9点插入一个与近期观众特别关心内容相关联的视频内容')) {
        return markReturn(plannerResponse({
          mode: 'react',
          actions: [],
          reactTask: {
            objective: '先查证近期观众关心内容相关素材，再进入9点插入候选选择',
            maxTurns: 3,
            batchSize: 3,
            stopCondition: '找到插入候选后进入选择确认，不直接写播单',
            nextActions: [{
              type: 'research_check',
              purpose: 'candidate_precheck',
              targetTime: '09:00:00',
              semanticLabel: '近期观众关心内容相关视频',
              programTypeHint: 'news_magazine',
              queries: ['看东方 民生 热点', '新闻 观众 关心 民生', '热点 生活 服务 视频'],
            }],
          },
          assistantReplyDraft: '我先查一下近期观众关心的相关视频素材，找到候选后让你选，不会直接写播单。',
          reasoning: '用户有插入时间，但节目内容模糊，需要先查证素材。',
        }))
      }

      if (userInput.includes('把全部看东方节目删除掉')) {
        if (options?.traceLabel === 'agent.intent_interpreter') {
          return markReturn(plannerResponse({
            intent: 'batch_delete',
            confidence: 0.94,
            slots: {
              targetProgramName: '看东方',
            },
            taskPlanDraft: {
              isComposite: true,
              goal: '删除当前播单里全部看东方节目',
              stages: [
                {
                  type: 'batch_atomic',
                  action: 'batch_delete',
                  target: {
                    programName: '看东方',
                    scope: 'current_playlist',
                  },
                  requiresConfirmation: true,
                  summary: '定位并删除全部看东方节目',
                },
              ],
            },
            assistantFeedback: '我理解你要删除当前播单里的全部《看东方》，我会先列出影响范围，确认后再执行。',
            reasoning: '用户要求批量删除同名节目。',
          }))
        }
        return markReturn(plannerResponse({
          actions: [{ type: 'atomic_command' }],
          assistantReplyDraft: '我理解你要删除当前播单里的全部《看东方》，我会先列出影响范围，确认后再执行。',
          reasoning: '用户提出批量删除，交给原子和复合任务能力处理。',
        }))
      }

      if (userInput.includes('把4点到10点全部节目删掉')) {
        if (options?.traceLabel === 'agent.intent_interpreter') {
          return markReturn(plannerResponse({
            intent: 'batch_delete',
            confidence: 0.97,
            slots: {
              rangeStart: '04:00:00',
              rangeEnd: '10:00:00',
            },
            taskPlanDraft: {
              isComposite: true,
              goal: '删除当前电视播单04:00到10:00时段内的全部节目',
              stages: [{
                type: 'batch_atomic',
                action: 'delete',
                target: {
                  rangeStart: '04:00:00',
                  rangeEnd: '10:00:00',
                  scope: 'time_range',
                },
                requiresConfirmation: true,
                summary: '分批删除04:00到10:00时段内的全部节目',
              }],
            },
            assistantFeedback: '我会先列出04:00到10:00的影响范围，确认后分批删除。',
            reasoning: '用户明确给出时间范围和全部删除要求，应形成受确认保护的分批任务。',
          }))
        }
        return markReturn(plannerResponse({
          actions: [{ type: 'atomic_command' }],
          assistantReplyDraft: '我会先核对04:00到10:00的节目范围，确认后再分批删除。',
          reasoning: '范围删除交给原子能力编译为有上限的复合任务。',
        }))
      }

      if (userInput.includes('当前播单有什么节目') || userInput.includes('这张编单整体风格怎么样') || userInput.includes('那怎么优化')) {
        if (options?.traceLabel === 'agent.intent_interpreter') {
          return markReturn(plannerResponse({
            intent: 'query',
            confidence: 0.94,
            pendingAction: promptText.includes('pendingTask') ? 'start_new_task' : undefined,
            queryKind: 'schedule_summary',
            slots: {},
            assistantFeedback: '我先看当前播单内容，这只是查询，不会改动播单。',
            reasoning: '用户开始询问当前播单内容，应结束上一条待确认修改并按只读查询处理。',
          }))
        }
        return markReturn(plannerResponse({
          pendingAction: 'start_new_task',
          actions: [{ type: 'read_only_analysis', analysisKind: userInput.includes('优化') ? 'optimization_suggestion' : 'playlist_analysis' }],
          assistantReplyDraft: '我先只看当前编单内容，不会改动播单。',
          reasoning: '用户是在询问当前编单情况或优化建议。',
        }))
      }

      if (userInput.includes('晚上18点到20点补新闻')) {
        if (!promptText.includes('"completeness":{"status":"partial"')) {
          throw new Error('goal37 expected planner prompt to include partial layout-draft completeness')
        }
        return markReturn(plannerResponse({
          actions: [{
            type: 'refine_layout_draft',
            ignoreExistingLayout: false,
            segments: [
              { start: '18:00:00', end: '20:00:00', semanticLabel: '晚间新闻', programTypeHint: 'news' },
              { start: '20:00:00', end: '22:00:00', semanticLabel: '黄金剧场', programTypeHint: 'drama' },
            ],
          }],
          assistantReplyDraft: '我会在现有白天草案后补上晚间新闻和黄金剧场，只更新草案，不写正式播单。',
          reasoning: 'foregroundContext 显示当前电视草案只覆盖到18点，用户明确要求续补晚间草案。',
        }))
      }

      if (userInput.includes('帮我全天编排')) {
        return markReturn(plannerResponse({
          mode: 'react',
          actions: [{ type: 'formal_orchestration', mode: 'full_generate', taskKind: 'full_day', useLayoutDraft: true, searchKeywords: [] }],
          reactTask: formalReactTask('按当前草案重新编排全天电视播单'),
          assistantReplyDraft: '我会先确认是否会覆盖当前正式播单，再继续全天编排。',
          reasoning: '用户要求对已有电视播单做全天编排。',
        }))
      }

      if (userInput.includes('按这个开始编排') || userInput.includes('参考草案编排')) {
        return markReturn(plannerResponse({
          mode: 'react',
          actions: [{ type: 'formal_orchestration', mode: 'full_generate', taskKind: 'full_day', useLayoutDraft: true, searchKeywords: [] }],
          reactTask: formalReactTask('按当前草案开始正式编排'),
          assistantReplyDraft: '我会按当前草案进入正式编排；如果草案不完整，会先提醒你补齐。',
          reasoning: '用户确认草案进入正式编排。',
        }))
      }

      if (userInput.includes('第一段') && (userInput.includes('金山区') || userInput.includes('静安区') || userInput.includes('最近3年最火'))) {
        return markReturn(plannerResponse({
          actions: [{
            type: 'research_check',
            purpose: 'candidate_precheck',
            targetSegmentIndex: 1,
            semanticLabel: '静安寺和商圈热门景点素材',
            programTypeHint: 'news_magazine',
            queries: ['静安寺 宣传片', '静安寺 商圈 现场', '上海 景点 城市宣传片'],
          }],
          assistantReplyDraft: '我先查一下这一段有没有合适素材；能定位到草案段就直接更新草案，不会写入节目。',
          reasoning: '用户要求先核验草案段的素材方向。',
        }))
      }

      if (userInput.includes('帮我排完整这张轮播单')) {
        return markReturn(plannerResponse({
          mode: 'react',
          actions: [{ type: 'formal_orchestration', mode: 'full_generate', taskKind: 'full_day', useLayoutDraft: true, searchKeywords: [] }],
          reactTask: formalReactTask('按轮播草案编排完整轮播单'),
          assistantReplyDraft: '我先检查这张轮播单的草案。没有草案时，我不能直接排完整单；你可以先告诉我总时长和主要内容，我帮你整理草案。',
          reasoning: '用户要整体编排轮播单，轮播单整体编排必须有草案。',
        }))
      }

      if (userInput.includes('新建一个1小时40分钟轮播单，拆成10段亚洲队介绍')) {
        return markReturn(plannerResponse({
          actions: [
            { type: 'create_playlist', playlistType: 'rotation', rotationStrategy: 'content_match', rotationDurationSeconds: 6000 },
            {
              type: 'prepare_layout_draft',
              rotationDurationSeconds: 6000,
              semanticLabel: '亚洲队介绍轮播草案',
              segments: Array.from({ length: 10 }, (_, index) => ({
                start: `0${Math.floor(index / 6)}:${String((index % 6) * 10).padStart(2, '0')}:00`,
                end: `0${Math.floor((index + 1) / 6)}:${String(((index + 1) % 6) * 10).padStart(2, '0')}:00`,
                semanticLabel: `亚洲队${index + 1}介绍`,
                programTypeHint: 'sports',
              })),
            },
          ],
          assistantReplyDraft: '我先建一张1小时40分钟轮播单，并拆成10个亚洲队介绍草案块。确认前不会写入正式节目。',
          reasoning: '用户要求新建轮播单并生成10个编号草案块。',
        }))
      }

      if (userInput.includes('亚洲队10介绍换成中国队介绍')) {
        return markReturn(plannerResponse({
          actions: [{
            type: 'refine_layout_draft',
            rotationDurationSeconds: 6000,
            targetSegmentIndex: 10,
            targetSegmentLabel: '亚洲队10介绍',
            semanticLabel: '中国队介绍',
            programTypeHint: 'sports',
          }],
          assistantReplyDraft: '我会把第10段从亚洲队10介绍调整为中国队介绍，只更新草案，不写正式节目。',
          reasoning: '用户按草案块名称提出局部微调。',
        }))
      }

      if (userInput.includes('新建一个1小时轮播草案')) {
        return markReturn(plannerResponse({
          actions: [{
            type: 'prepare_layout_draft',
            rotationDurationSeconds: 3600,
            semanticLabel: '世界杯专题轮播草案',
            segments: [
              { start: '00:00:00', end: '00:30:00', semanticLabel: '世界杯亚洲球队介绍', programTypeHint: 'sports' },
              { start: '00:30:00', end: '01:00:00', semanticLabel: '世界杯精彩回顾', programTypeHint: 'sports' },
            ],
          }],
          assistantReplyDraft: '我先把它整理成一份1小时轮播草案，确认前不会写入正式轮播单。你可以继续改每一段，也可以确认后再开始编排。',
          reasoning: '用户正在补轮播草案，LLM 已拆分为两个内容块。',
        }))
      }

      if (userInput.includes('把第一段改成中国队和日本队介绍')) {
        return markReturn(plannerResponse({
          actions: [{
            type: 'refine_layout_draft',
            rotationDurationSeconds: 3600,
            segments: [
              { start: '00:00:00', end: '00:30:00', semanticLabel: '中国队和日本队介绍', programTypeHint: 'sports' },
            ],
          }],
          assistantReplyDraft: '我把第一段改成中国队和日本队介绍，仍然只更新草案，不写入正式轮播单。',
          reasoning: '用户对现有草案提出局部修改。',
        }))
      }

      if (userInput.includes('新建一个1小时轮播单，主要涵盖世界杯亚洲球队介绍')) {
        return markReturn(plannerResponse({
          actions: [
            { type: 'create_playlist', playlistType: 'rotation', rotationStrategy: 'content_match', rotationDurationSeconds: 3600 },
            {
              type: 'prepare_layout_draft',
              rotationDurationSeconds: 3600,
              semanticLabel: '世界杯亚洲球队介绍',
              segments: [
                { start: '00:00:00', end: '00:20:00', semanticLabel: '中国队介绍', programTypeHint: 'sports' },
                { start: '00:20:00', end: '00:40:00', semanticLabel: '日本队介绍', programTypeHint: 'sports' },
                { start: '00:40:00', end: '01:00:00', semanticLabel: '韩国队介绍', programTypeHint: 'sports' },
              ],
            },
          ],
          assistantReplyDraft: '我先建一张1小时轮播单，并把世界杯亚洲球队介绍拆成三个草案块。确认前不会写入正式节目。',
          reasoning: '用户一句话同时包含新建轮播单和生成草案。',
        }))
      }

      if (userInput.includes('新建一个1小时轮播单，先查世界杯亚洲球队素材再决定草案')) {
        return markReturn(plannerResponse({
          mode: 'react',
          actions: [
            { type: 'create_playlist', playlistType: 'rotation', rotationStrategy: 'content_match', rotationDurationSeconds: 3600 },
            {
              type: 'prepare_layout_draft',
              rotationDurationSeconds: 3600,
              semanticLabel: '世界杯亚洲球队素材查证草案',
              segments: [
                { start: '00:00:00', end: '01:00:00', semanticLabel: '世界杯亚洲球队素材', programTypeHint: 'documentary' },
              ],
            },
          ],
          reactTask: {
            objective: '先核验世界杯亚洲球队素材，再决定是否更新草案',
            maxTurns: 3,
            batchSize: 2,
            stopCondition: '素材方向明确后进入草案确认，不直接写正式播单',
            nextActions: [{
              type: 'research_check',
              purpose: 'candidate_precheck',
              targetSegmentIndex: 1,
              semanticLabel: '世界杯亚洲球队素材',
              programTypeHint: 'documentary',
              queries: ['世界杯 亚洲球队 介绍'],
            }],
          },
          assistantReplyDraft: '我先建一张1小时轮播单和草案，再用 canonical 素材库核验素材方向。确认前不会写入正式节目。',
          reasoning: '用户要求创建工作区后先查证素材再决定；实体来自 canonical 数据源。',
        }))
      }

      if (userInput.includes('新建一个1小时轮播单，主要涵盖上海景点介绍')) {
        return markReturn(plannerResponse({
          actions: [
            { type: 'create_playlist', playlistType: 'rotation', rotationStrategy: 'content_match', rotationDurationSeconds: 3600 },
            {
              type: 'prepare_layout_draft',
              rotationDurationSeconds: 3600,
              semanticLabel: '上海景点介绍',
              segments: [
                { start: '00:00:00', end: '00:30:00', semanticLabel: '静安寺景点宣传片', programTypeHint: 'news_magazine' },
                { start: '00:30:00', end: '01:00:00', semanticLabel: '商圈现场与城市形象片', programTypeHint: 'news_magazine' },
              ],
            },
          ],
          assistantReplyDraft: '我先建一张1小时轮播单，并把上海景点介绍拆成两个草案块。确认前不会写入正式节目。',
          reasoning: '用户一句话同时包含新建轮播单和生成上海景点草案。',
        }))
      }

      if (userInput.includes('新建一个3小时轮播单，先放1小时静安寺宣传片')) {
        return markReturn(plannerResponse({
          actions: [
            { type: 'create_playlist', playlistType: 'rotation', rotationStrategy: 'content_match', rotationDurationSeconds: 10800 },
            {
              type: 'prepare_layout_draft',
              rotationDurationSeconds: 10800,
              semanticLabel: '静安寺宣传片局部草案',
              segments: [
                { start: '00:00:00', end: '01:00:00', semanticLabel: '静安寺宣传片', programTypeHint: 'news_magazine' },
              ],
            },
          ],
          assistantReplyDraft: '我先建一张3小时轮播单，并放入1小时静安寺宣传片草案；剩余2小时还需要继续补充。',
          reasoning: '用户只给了3小时目标中的1小时内容。',
        }))
      }

      if (userInput.includes('草案全部改成第一小时新闻，第二小时电视剧生命树')) {
        return markReturn(plannerResponse({
          actions: [{
            type: 'refine_layout_draft',
            ignoreExistingLayout: true,
            rotationDurationSeconds: 7200,
            segments: [
              { start: '00:00:00', end: '01:00:00', semanticLabel: '新闻', programTypeHint: 'news' },
              { start: '01:00:00', end: '02:00:00', semanticLabel: '电视剧生命树', programTypeHint: 'drama' },
            ],
          }],
          assistantReplyDraft: '我把草案重写成两段：第一小时新闻，第二小时电视剧生命树；仍然不会写入正式播单。',
          reasoning: '用户明确要求重写草案。',
        }))
      }

      // 以下分支处理依赖 pending review 状态的简短确认类回复，必须放在 fallback 之前。
      if (userInput === '确认重新编排') {
        return markReturn(plannerResponse({
          mode: 'react',
          actions: [{ type: 'formal_orchestration', mode: 'full_generate', taskKind: 'full_day', useLayoutDraft: true, searchKeywords: [], confirmExistingRebuild: true }],
          reactTask: formalReactTask('用户确认后按当前版面草案重新编排正式播单'),
          assistantReplyDraft: '我已收到确认，现在开始按当前版面草案重新编排正式播单。',
          reasoning: '用户确认了对已有电视播单的正式重编请求。',
        }))
      }

      if (userInput === '确认') {
        if (options?.traceLabel === 'agent.intent_interpreter') {
          return markReturn(plannerResponse({
            intent: 'delete',
            confidence: 0.98,
            pendingAction: 'confirm',
            slots: {},
            assistantFeedback: '我理解你在确认执行当前待处理的删除任务。',
            reasoning: '当前上下文包含待确认删除任务，用户明确确认。',
          }))
        }
        return markReturn(plannerResponse({
          actions: [{ type: 'atomic_command', intent: 'batch_delete', pendingAction: 'confirm' }],
          assistantReplyDraft: '我已收到确认，现在执行这条待确认操作。',
          reasoning: '用户确认了当前待执行的原子或复合操作。',
        }))
      }

      if (userInput === '继续') {
        if (options?.traceLabel === 'agent.intent_interpreter') {
          return markReturn(plannerResponse({
            intent: 'delete',
            confidence: 0.96,
            pendingAction: 'confirm',
            slots: {},
            assistantFeedback: '我理解你要继续重试上一批未写入成功的删除任务。',
            reasoning: '当前上下文保留了可重试的删除批次，用户要求继续。',
          }))
        }
        return markReturn(plannerResponse({
          actions: [{ type: 'atomic_command', intent: 'batch_delete', pendingAction: 'confirm' }],
          assistantReplyDraft: '我会继续重试上一批未写入成功的删除任务。',
          reasoning: '用户要求继续当前可恢复的原子任务。',
        }))
      }

      return markReturn(plannerResponse({
        actions: [{ type: 'clarify', question: '我还需要你再说清楚一点。' }],
        assistantReplyDraft: '我还需要你再说清楚一点。',
        reasoning: 'Goal 37 fallback response.',
      }))
    }
  })
}

const sendMessage = async (page, text) => {
  await page.locator('textarea').fill(text)
  try {
    await page.waitForFunction(() => {
      const button = document.querySelector('button.send-action-button')
      return button instanceof HTMLButtonElement && !button.disabled
    }, null, { timeout: 60_000 })
  } catch (error) {
    const debugState = await page.evaluate(() => {
      const button = document.querySelector('button.send-action-button')
      const textarea = document.querySelector('textarea')
      return {
        buttonDisabled: button instanceof HTMLButtonElement ? button.disabled : null,
        buttonClassName: button instanceof HTMLElement ? button.className : null,
        buttonTitle: button instanceof HTMLElement ? button.getAttribute('title') : null,
        textareaValue: textarea instanceof HTMLTextAreaElement ? textarea.value : null,
        bodyTail: document.body.innerText.split('\n').slice(-30),
        runtimeTrace: window.__AIBIANDAN_RUNTIME_TRACE__ ?? [],
      }
    })
    throw new Error(`send button did not become enabled for "${text}": ${JSON.stringify(debugState, null, 2)}`)
  }
  await page.locator('button.send-action-button').click()
}

const waitForText = async (page, patterns, timeout = 60_000) => {
  const list = Array.isArray(patterns) ? patterns : [patterns]
  await page.waitForFunction((expected) => {
    const text = document.body.innerText
    return expected.every((item) => text.includes(item))
  }, list, { timeout })
}

const bodyLines = async (page, matcher) => {
  const text = await page.locator('body').innerText()
  return text.split('\n').map((line) => line.trim()).filter((line) => line && (!matcher || matcher.test(line)))
}

const openLatestDetailsAndRead = async (page) => {
  const processToggles = page.locator('.process-toggle')
  await processToggles.last().click({ timeout: 10_000 })
  const toggles = page.locator('.details-toggle')
  await toggles.last().click({ timeout: 10_000 })
  await waitForText(page, ['本轮轨迹'])
  return page.locator('body').innerText()
}

const waitForPageHarness = async (page) => {
  await page.waitForFunction(() => Boolean(window.__AIBIANDAN_PAGE_HARNESS__), { timeout: 30_000 })
}

const seedTvSchedule = async (page, items) => {
  await waitForPageHarness(page)
  await page.evaluate((seedItems) => {
    window.__AIBIANDAN_PAGE_HARNESS__.seedTvSchedule(seedItems)
  }, items)
}

const seedTvLayoutDraft = async (page, draft) => {
  await waitForPageHarness(page)
  await page.evaluate((seedDraft) => window.__AIBIANDAN_PAGE_HARNESS__.seedTvLayoutDraft(seedDraft), draft)
}

const seedRotationSchedule = async (page, items, options) => {
  await waitForPageHarness(page)
  await page.evaluate(({ seedItems, seedOptions }) => {
    window.__AIBIANDAN_PAGE_HARNESS__.seedRotationSchedule(seedItems, seedOptions)
  }, { seedItems: items, seedOptions: options })
}

const failNextAtomicReplaceAllItems = async (page, message) => {
  await waitForPageHarness(page)
  await page.evaluate((failureMessage) => {
    window.__AIBIANDAN_PAGE_HARNESS__.failNextAtomicReplaceAllItems(failureMessage)
  }, message)
}

const scenarios = [
  {
    id: 'planner-no-action-create-feedback-visible',
    description: 'planner 没有返回创建动作时，执行语气被转换为可见的无写入终态',
    userInput: '请先整理版面草案再新建电视播单',
    expectedDecision: '显示尚未创建播单的结构化澄清，空工作区保持不变',
    mustNotHappen: '按正文中的“版面草案”隐藏终态、只留下冻结进度或伪造创建动作',
    verification: '页面显示“还没有创建播单”，playlistType 与 currentPlaylistId 均为空',
    run: async (page) => {
      await sendMessage(page, '请先整理版面草案再新建电视播单')
      await waitForText(page, ['还没有创建播单', '模型没有返回有效的创建动作'])

      const state = await page.evaluate(() => window.__AIBIANDAN_PAGE_HARNESS__.getState())
      if (state.playlistType !== 'none' || state.currentPlaylistId) {
        throw new Error(`Planner reply without action unexpectedly created a playlist: ${JSON.stringify(state)}.`)
      }
      const text = await page.locator('body').innerText()
      if (!text.includes('还没有创建播单')) {
        throw new Error('No-action planner terminal feedback is not visible to the user.')
      }

      return {
        evidence: (await bodyLines(page, /还没有创建播单|版面草案|创建动作|等待创建/)).slice(-16),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'tv-react-create-preserves-conversation',
    description: '无播单会话中的目标保持可见，ReAct 多动作首轮真实创建电视播单且不展示协议文案',
    userInput: '就按刚才讨论的目标，新建电视播单，然后按当前版面开始全天编排',
    expectedDecision: '先创建真实电视播单并保留会话目标，后续正式编排等待 observation 后继续 decide',
    mustNotHappen: '只展示命令序列、隐藏创建前对话、出现完整接收/结构校验气泡或跳过建单',
    verification: '页面 workspace=tv 且 playlistId 存在，创建前目标仍可见，内部协议文案不可见',
    run: async (page) => {
      await sendMessage(page, '上午以新闻和民生内容为主')
      await waitForText(page, ['我记下了这个编排目标', '电视播单还是轮播单'])

      await sendMessage(page, '就按刚才讨论的目标，新建电视播单，然后按当前版面开始全天编排')
      await waitForText(page, ['当前工作区 · 电视播单', '已新建电视播单', '上午以新闻和民生内容为主'])

      const state = await page.evaluate(() => window.__AIBIANDAN_PAGE_HARNESS__.getState())
      if (state.playlistType !== 'tv' || !state.currentPlaylistId) {
        throw new Error(`Ordered ReAct plan did not create a real TV playlist: ${JSON.stringify(state)}.`)
      }
      const text = await page.locator('body').innerText()
      if (text.includes('完整接收') || text.includes('结构校验')) {
        throw new Error('Internal structured-complete protocol text leaked into the user conversation.')
      }
      if (!text.includes('上午以新闻和民生内容为主')) {
        throw new Error('Pre-creation conversation disappeared after the playlist workspace was created.')
      }

      return {
        evidence: (await bodyLines(page, /上午|民生|电视播单|全天编排|工作区/)).slice(-20),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'tv-partial-layout-suggest-refine',
    description: '电视部分草案先阻拦全天编排，再由 planner 续补晚间多段且不改正式播单',
    userInput: '草案只到下午，晚上18点到20点补新闻，20点到22点补剧场',
    expectedDecision: 'planner 读取 partial 完整度并返回 refine_layout_draft，多段续补保留白天草案',
    mustNotHappen: '前台本地猜测续接、丢弃既有白天草案、启动正式编排或写入正式节目',
    verification: '先明确提示草案只覆盖部分时段；续补后草案含白天/晚间新闻/黄金剧场三段，itemCount 仍为 0',
    run: async (page) => {
      await seedTvLayoutDraft(page, {
        id: 'goal37-partial-tv-draft',
        channelId: 'dragon',
        date: '2026-03-25',
        version: 1,
        source: 'generated',
        userIntent: '白天版面草案',
        coverage: { start: '06:00:00', end: '18:00:00' },
        layoutReference: {
          id: 'goal37-partial-tv-layout',
          name: '白天版面草案',
          slots: [{
            id: 'goal37-slot-daytime', channelId: 'dragon',
            startTime: '2026-03-25T06:00:00+08:00', endTime: '2026-03-25T18:00:00+08:00',
            columnId: 'goal37-column-daytime',
          }],
        },
        columns: [{
          columnId: 'goal37-column-daytime', columnName: '白天综合版面', channelId: 'dragon',
          defaultProgramType: 'news_magazine', semanticLabel: '白天综合版面', source: 'generated',
        }],
      })
      await waitForText(page, ['当前工作区 · 电视播单', '白天综合版面'])

      await sendMessage(page, '帮我全天编排')
      await waitForText(page, ['这份草案只写了一部分', '缺的时段'])

      await sendMessage(page, '草案只到下午，晚上18点到20点补新闻，20点到22点补剧场')
      await waitForText(page, ['已按你的要求更新当前版面草案', '晚间新闻', '黄金剧场'])

      const state = await page.evaluate(() => window.__AIBIANDAN_PAGE_HARNESS__.getState())
      const expectedLabels = ['白天综合版面', '晚间新闻', '黄金剧场']
      if (JSON.stringify(state.layoutDraftLabels) !== JSON.stringify(expectedLabels)) {
        throw new Error(`Partial draft continuation lost or reordered segments: ${JSON.stringify(state.layoutDraftLabels)}.`)
      }
      if (state.layoutDraftCoverage?.start !== '06:00:00' || state.layoutDraftCoverage?.end !== '22:00:00') {
        throw new Error(`Partial draft coverage was not extended correctly: ${JSON.stringify(state.layoutDraftCoverage)}.`)
      }
      if (state.itemCount !== 0) {
        throw new Error(`Draft refinement unexpectedly wrote the formal playlist; itemCount=${state.itemCount}.`)
      }

      const calls = await page.evaluate(() => window.__goal37LlmCalls ?? [])
      const refineCall = calls.find((call) => call.userInput.includes('晚上18点到20点补新闻'))
      if (!refineCall?.responsePreview?.includes('refine_layout_draft')) {
        throw new Error('Partial draft continuation was not decided by planner refine_layout_draft action.')
      }
      const lines = await bodyLines(page, /部分|补草案|白天综合|晚间新闻|黄金剧场|正式播单/)
      return {
        evidence: lines.slice(-22),
        llmCalls: calls,
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'formal-react-explicit-approval-resume',
    description: '正式 ReAct 敏感删除进入独立审批条，显式确认后沿 checkpoint 恢复写入',
    userInput: '执行ReAct审批测试',
    expectedDecision: 'research observation 后进入 waiting_user，确认按钮调用 confirm_pending 并完成删除',
    mustNotHappen: '自动批准删除、把确认按钮转成自然语言、确认前删除节目或递归创建第二个 run',
    verification: '审批条可见且目标节目仍在；点击确认后审批条消失、目标节目删除、无页面错误',
    run: async (page) => {
      await seedTvSchedule(page, [
        {
          id: 'react-delete-target', startTime: '19:00:00', endTime: '19:30:00',
          programName: '待删除测试节目', durationSeconds: 1800, programType: 'news_magazine',
        },
      ])
      await waitForText(page, ['当前工作区 · 电视播单', '待删除测试节目'])

      await sendMessage(page, '执行ReAct审批测试')
      await waitForText(page, ['等待确认', '确认后从已保存的检查点继续', '确认执行'])
      let state = await page.evaluate(() => window.__AIBIANDAN_PAGE_HARNESS__.getState())
      if (state.itemCount !== 1) {
        throw new Error(`Pending ReAct deletion mutated before confirmation; itemCount=${state.itemCount}.`)
      }

      await page.getByRole('button', { name: '确认执行', exact: true }).click()
      await page.waitForFunction(() => window.__AIBIANDAN_PAGE_HARNESS__.getState().itemCount === 0, null, { timeout: 60_000 })
      await page.waitForFunction(() => !document.body.innerText.includes('确认后从已保存的检查点继续'), null, { timeout: 60_000 })
      state = await page.evaluate(() => window.__AIBIANDAN_PAGE_HARNESS__.getState())
      if (state.itemCount !== 0) {
        throw new Error(`Confirmed ReAct deletion did not update the formal playlist; itemCount=${state.itemCount}.`)
      }

      const lines = await bodyLines(page, /ReAct|审批|等待确认|确认执行|待删除测试节目|正式编排/)
      return {
        evidence: lines.slice(-20),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'rotation-gate-draft-refine',
    description: '轮播无草案整体编排先阻拦，再生成草案，再局部改草案',
    run: async (page) => {
      await page.getByRole('button', { name: '新建轮播单' }).click()
      await waitForText(page, ['当前工作区 · 轮播单'])

      await sendMessage(page, '帮我排完整这张轮播单')
      await waitForText(page, ['这张轮播单还没有可用草案', '不能直接整体编排'])

      await sendMessage(page, '新建一个1小时轮播草案，第一段是世界杯亚洲球队介绍，第二段是世界杯精彩回顾')
      await waitForText(page, ['世界杯亚洲球队介绍', '世界杯精彩回顾'])

      await sendMessage(page, '把第一段改成中国队和日本队介绍')
      await waitForText(page, ['中国队和日本队介绍'])

      const lines = await bodyLines(page, /轮播|草案|世界杯|中国队|正式|整体编排/)
      return {
        evidence: lines.slice(-16),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'rotation-upload-layout-xls',
    description: '轮播工作区真实上传 xlsx 后激活独立轮播草案，确认前不写正式播单',
    userInput: '上传这个轮播草案，按它来排',
    expectedDecision: '文件导入形成 source=uploaded、strategyProfile.kind=carousel 的当前草案，正式播单保持为空',
    mustNotHappen: '把上传版面当成电视默认草案、上传后立即启动正式编排、制造测试业务实体或写正式节目',
    verification: 'Playwright 向真实 file input 上传固定 xlsx；页面显示导入成功，草案有时段，itemCount=0',
    run: async (page) => {
      await page.getByRole('button', { name: '新建轮播单' }).click()
      await waitForText(page, ['当前工作区 · 轮播单'])

      const fixturePath = path.join(rootDir, 'test-fixtures/browser/smg-weekday-layout.xlsx')
      if (!existsSync(fixturePath)) {
        throw new Error(`data_fixture_missing: ${fixturePath}`)
      }
      await page.locator('input.layout-file-input').setInputFiles(fixturePath)
      await page.waitForFunction(() => {
        const state = window.__AIBIANDAN_PAGE_HARNESS__?.getState?.()
        return state?.layoutDraftSource === 'uploaded' && state.layoutDraftSegments > 0
      }, null, { timeout: 60_000 })

      const state = await page.evaluate(() => window.__AIBIANDAN_PAGE_HARNESS__.getState())
      if (state.layoutDraftSource !== 'uploaded') {
        throw new Error(`Uploaded rotation draft source should be uploaded, got ${state.layoutDraftSource}.`)
      }
      if (state.layoutDraftStrategyKind !== 'carousel') {
        throw new Error(`Uploaded rotation draft should use carousel strategy, got ${state.layoutDraftStrategyKind}.`)
      }
      if (state.layoutDraftSegments < 1) {
        throw new Error('Uploaded rotation draft did not expose any parsed layout segments.')
      }
      if (state.itemCount !== 0) {
        throw new Error(`Uploading a rotation draft unexpectedly wrote formal items; itemCount=${state.itemCount}.`)
      }

      const lines = await bodyLines(page, /轮播|上传|导入|草案|smg-weekday-layout|正式播单/)
      return {
        evidence: lines.slice(-24),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'one-shot-create-rotation-with-draft',
    description: '用户一句话同时新建轮播单和草案，LLM 返回两个动作并落到左侧草案；可拆成多段，也可先保留一个总内容块',
    run: async (page) => {
      await sendMessage(page, '新建一个1小时轮播单，主要涵盖世界杯亚洲球队介绍')
      await waitForText(page, ['当前工作区 · 轮播单', '轮播草案', '目标总时长 1小时', '世界杯亚洲球队介绍'])

      const lines = await bodyLines(page, /轮播|草案|中国队|日本队|韩国队|正式/)
      return {
        evidence: lines.slice(-16),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'rotation-draft-numbered-segment-refine',
    description: '轮播草案按编号块局部修改时，第10段不能被误认为第1段',
    run: async (page) => {
      await sendMessage(page, '新建一个1小时40分钟轮播单，拆成10段亚洲队介绍')
      await waitForText(page, ['当前工作区 · 轮播单', '亚洲队1介绍', '亚洲队10介绍'])

      await sendMessage(page, '亚洲队10介绍换成中国队介绍')
      await waitForText(page, ['已按你的要求更新当前轮播草案', '中国队介绍'])

      const labels = await page.locator('.layout-draft-workspace-label').allTextContents()
      if (labels[0] !== '亚洲队1介绍') {
        throw new Error(`Expected first draft segment to stay 亚洲队1介绍, got ${labels[0] ?? '<missing>'}.`)
      }
      if (labels[9] !== '中国队介绍') {
        throw new Error(`Expected tenth draft segment to become 中国队介绍, got ${labels[9] ?? '<missing>'}.`)
      }
      if (labels.filter((label) => label === '亚洲队1介绍').length !== 1) {
        throw new Error(`Expected only one 亚洲队1介绍 segment, got ${labels.join(' / ')}.`)
      }

      const lines = await bodyLines(page, /亚洲队|中国队|第10段|轮播|草案/)
      return {
        evidence: lines.slice(-20),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'recoverable-llm-failure',
    description: '模型失败时给出可恢复反馈，并且不写草案或正式节目',
    run: async (page) => {
      await page.getByRole('button', { name: '新建轮播单' }).click()
      await waitForText(page, ['当前工作区 · 轮播单'])

      await sendMessage(page, '模拟模型失败')
      await waitForText(page, ['这次模型服务没有正常返回', '我还没有修改草案或播单'])

      const lines = await bodyLines(page, /失败|模型|没有修改|轮播|草案|播单/)
      return {
        evidence: lines.slice(-12),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'atomic-insert-candidate-recommendation',
    description: '电视播单原子插入候选不唯一时，只给候选建议和补充方向，不进入待确认执行',
    run: async (page) => {
      await page.getByRole('button', { name: '新建电视播单' }).click()
      await waitForText(page, ['当前工作区 · 电视播单'])

      await sendMessage(page, '9点插入看东方')
      await waitForText(page, ['看东方', '现在还不能替你直接选其中一个', '你可以补充'])
      const text = await page.locator('body').innerText()
      if (text.includes('待确认插入节目') || text.includes('候选推荐')) {
        throw new Error('Multiple insert candidates should be shown as assistant recommendation text, not a pending selection panel.')
      }
      const calls = await page.evaluate(() => window.__goal37LlmCalls ?? [])
      const insertCalls = calls.filter((call) =>
        call.traceLabel === 'agent.intent_interpreter' && call.userInput.includes('9点插入看东方')
      )
      if (insertCalls.length !== 1) {
        throw new Error(`Expected one intent-interpreter call for TV insert, got ${insertCalls.length}.`)
      }
      const judgeCalls = calls.filter((call) =>
        call.traceLabel === 'agent.candidate_judge' && call.userInput.includes('9点插入看东方')
      )
      if (judgeCalls.length !== 1) {
        throw new Error(`Expected one candidate-judge call for ambiguous TV insert, got ${judgeCalls.length}.`)
      }
      const detailsText = await openLatestDetailsAndRead(page)
      if (!detailsText.includes('本轮轨迹') || !detailsText.includes('未写入')) {
        throw new Error('Insert recommendation details should show non-write status.')
      }

      const lines = await bodyLines(page, /电视播单|看东方|9点|候选|补充|直接选/)
      return {
        evidence: lines.slice(-18),
        llmCalls: calls,
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'precise-atomic-insert-does-not-react',
    description: '精准原子插入不激活 ReAct，仍走原子候选/确认链路',
    run: async (page) => {
      await page.getByRole('button', { name: '新建电视播单' }).click()
      await waitForText(page, ['当前工作区 · 电视播单'])

      await sendMessage(page, '9点插入电视剧生命树第5集')
      await page.waitForFunction(() => (window.__goal37LlmCalls ?? []).some((call) => call.userInput.includes('生命树第5集') && call.returned), null, { timeout: 60_000 })
      const calls = await page.evaluate(() => window.__goal37LlmCalls ?? [])
      const plannerCall = calls.find((call) => call.userInput.includes('生命树第5集'))
      if (plannerCall?.responsePreview?.includes('"mode":"react"') || plannerCall?.responsePreview?.includes('"reactTask"')) {
        throw new Error('Precise atomic insert unexpectedly activated ReAct.')
      }
      const preciseCalls = calls.filter((call) =>
        call.traceLabel === 'agent.intent_interpreter' && call.userInput.includes('生命树第5集')
      )
      if (preciseCalls.length !== 1) {
        throw new Error(`Expected one intent-interpreter call for precise drama insert, got ${preciseCalls.length}.`)
      }
      const detailsText = await openLatestDetailsAndRead(page)
      if (!detailsText.includes('本轮轨迹') || !detailsText.includes('模型 1 次')) {
        throw new Error('Precise drama insert details should expose one-call trace summary.')
      }

      const lines = await bodyLines(page, /生命树|9点|待确认|候选|插入/)
      return {
        evidence: lines.slice(-18),
        llmCalls: calls,
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'tv-followup-recommend-keeps-formal-insert-context',
    description: '电视播单缺节目线索后回复“你可以推荐”，继续正式插入上下文，不误更新草案',
    run: async (page) => {
      await seedTvSchedule(page, [
        { startTime: '22:30:00', endTime: '23:00:00', programName: '锦点第001期：当日观察', durationSeconds: 1800, programType: 'commentary' },
        { startTime: '23:00:00', endTime: '23:30:00', programName: '两说第001期：双城观察', durationSeconds: 1800, programType: 'commentary' },
      ])
      await waitForText(page, ['当前工作区 · 电视播单', '两说第001期'])

      await sendMessage(page, '23:30之后帮我再排入个节目')
      await waitForText(page, ['我理解你想在23:30之后补一个节目', '23:30', '缺节目方向'])
      await sendMessage(page, '你可以推荐')
      await waitForText(page, ['我按当前电视播单的23:30位置继续推荐'])
      await waitForText(page, ['查节目库', '今晚', '23:30'])
      await waitForText(page, ['23:30', '晚间观察', '现在还不能替你直接选其中一个'])

      const text = await page.locator('body').innerText()
      if (!text.includes('正在按') || !text.includes('查节目库')) {
        throw new Error('Follow-up recommendation should expose a visible candidate lookup progress step.')
      }
      if (text.includes('已更新草案') || text.includes('待确认更新草案')) {
        throw new Error('Follow-up recommendation should stay on the formal insert path, not update layout draft.')
      }
      if (text.includes('上一条待确认操作已失效')) {
        throw new Error('A non-write clarification context should not expire when the user asks for a recommendation.')
      }

      const lines = await bodyLines(page, /理解|查节目库|23:30|晚间观察|推荐|候选|草案|失效|正式播单/)
      return {
        evidence: lines.slice(-20),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'pending-new-topic-expires',
    description: '正式重编待确认时，LLM 显式开始新查询任务，旧 pending 不得执行',
    run: async (page) => {
      await seedTvSchedule(page, [
        { startTime: '07:00:00', endTime: '08:00:00', programName: '看东方 第112期', durationSeconds: 3600 },
        { startTime: '09:00:00', endTime: '09:45:00', programName: '品质剧场 第8集', durationSeconds: 2700 },
      ])
      await waitForText(page, ['当前工作区 · 电视播单', '看东方 第112期'])

      await sendMessage(page, '帮我全天编排')
      await waitForText(page, ['待确认重新编排', '确认重新编排'])

      await sendMessage(page, '当前播单有什么节目')
      await waitForText(page, ['现在只是分析，没有改动播单'])

      const lines = await bodyLines(page, /失效|分析|没有改动|看东方|待确认|播单/)
      return {
        evidence: lines.slice(-20),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'tv-full-rebuild-requires-confirmation',
    description: '电视播单已有内容时要求全天编排，必须先确认覆盖正式播单',
    run: async (page) => {
      await seedTvSchedule(page, [
        { startTime: '09:00:00', endTime: '09:45:00', programName: '看东方 第111期', relativeStart: '00:00:00', durationSeconds: 2700 },
        { startTime: '10:00:00', endTime: '10:45:00', programName: '品质剧场 第8集', relativeStart: '00:00:00', durationSeconds: 2700 },
      ])
      await waitForText(page, ['当前工作区 · 电视播单', '看东方 第111期'])

      await sendMessage(page, '帮我全天编排')
      await waitForText(page, ['待确认重新编排', '当前已有 2 条节目', '确认重新编排'])

      const lines = await bodyLines(page, /全天编排|重新编排|当前已有|确认|电视播单|看东方|品质剧场/)
      return {
        evidence: lines.slice(-20),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'tv-full-rebuild-confirm-starts-formal-orchestration',
    description: '电视播单重新编排经用户确认后，真实前台进入正式编排 runtime',
    run: async (page) => {
      await seedTvSchedule(page, [
        { startTime: '09:00:00', endTime: '09:45:00', programName: '看东方 第111期', relativeStart: '00:00:00', durationSeconds: 2700 },
        { startTime: '10:00:00', endTime: '10:45:00', programName: '品质剧场 第8集', relativeStart: '00:00:00', durationSeconds: 2700 },
      ])
      await waitForText(page, ['当前工作区 · 电视播单', '看东方 第111期'])

      await sendMessage(page, '帮我全天编排')
      await waitForText(page, ['待确认重新编排', '当前已有 2 条节目'])

      await sendMessage(page, '确认重新编排')
      await page.waitForFunction(() => (
        window.__AIBIANDAN_RUNTIME_TRACE__ ?? []
      ).some((entry) => entry.event === 'submit:decision' && entry.kind === 'orchestration'), null, { timeout: 60_000 })

      const lines = await bodyLines(page, /全天编排|重新编排|正式编排|版面草案|电视播单/)
      return {
        evidence: lines.slice(-22),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'tv-readonly-analysis-and-optimization',
    description: '电视播单只读分析后继续追问优化，LLM 给建议但不写入',
    run: async (page) => {
      await seedTvSchedule(page, [
        { startTime: '07:00:00', endTime: '08:00:00', programName: '看东方 第112期', durationSeconds: 3600 },
        { startTime: '12:00:00', endTime: '12:30:00', programName: '午间30分 第62期', durationSeconds: 1800 },
        { startTime: '19:30:00', endTime: '20:15:00', programName: '品质剧场 第9集', durationSeconds: 2700 },
      ])
      await waitForText(page, ['当前工作区 · 电视播单', '午间30分 第62期'])

      await sendMessage(page, '这张编单整体风格怎么样')
      await waitForText(page, ['整体节奏比较稳', '没有改动播单'])

      await sendMessage(page, '那怎么优化')
      await waitForText(page, ['同类新闻内容稍微分散', '要不要我把这个建议整理成草案调整方向'])

      const lines = await bodyLines(page, /整体|优化|建议|没有改动|新闻|专题|草案调整/)
      return {
        evidence: lines.slice(-22),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'rotation-research-check-pending',
    description: '轮播草案已存在时，用户要求局部素材核验，直接更新草案而不写正式播单',
    run: async (page) => {
      await sendMessage(page, '新建一个1小时轮播单，主要涵盖上海景点介绍')
      await waitForText(page, ['当前工作区 · 轮播单', '静安寺景点宣传片', '商圈现场与城市形象片'])

      await sendMessage(page, '第一段静安区景点部分，选择最近3年最火热的景点')
      await waitForText(page, ['静安寺、商圈现场这类素材', '已把“静安寺和商圈热门景点素材”更新到左侧草案的第 1 段', '正式播单还没有开始编排'])

      const lines = await bodyLines(page, /静安|商圈|素材|更新草案|确认|正式|轮播/)
      return {
        evidence: lines.slice(-22),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'rotation-partial-draft-formal-block',
    description: '轮播草案只覆盖局部时，用户要求正式编排必须先补齐草案',
    run: async (page) => {
      await sendMessage(page, '新建一个3小时轮播单，先放1小时静安寺宣传片')
      await waitForText(page, ['当前工作区 · 轮播单', '静安寺宣传片', '剩余2小时还需要继续补充'])

      await sendMessage(page, '按这个开始编排')
      await waitForText(page, ['还只覆盖了一部分目标时长', '不能直接整体编排'])

      const lines = await bodyLines(page, /静安寺|剩余|部分|目标时长|不能直接|整体编排/)
      return {
        evidence: lines.slice(-20),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'rotation-draft-rewrite-no-formal-write',
    description: '用户在草案页要求完全重写草案，只更新草案不写入正式播单',
    run: async (page) => {
      await sendMessage(page, '新建一个1小时轮播单，主要涵盖上海景点介绍')
      await waitForText(page, ['静安寺景点宣传片', '商圈现场与城市形象片'])

      await sendMessage(page, '草案全部改成第一小时新闻，第二小时电视剧生命树')
      await waitForText(page, ['新闻', '电视剧生命树', '确认前不会写入正式轮播单'])

      const lines = await bodyLines(page, /草案|新闻|电视剧生命树|不会写入|正式播单/)
      return {
        evidence: lines.slice(-22),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'recoverable-llm-retry-succeeds',
    description: '一次模型失败后，用户说继续，系统重试并成功落草案',
    goals: [38],
    userInput: '模拟一次失败后继续',
    expectedDecision: '第一次暴露可恢复 LLM 失败，用户重试后成功生成草案',
    mustNotHappen: 'LLM 失败后假装完成、自动写入或让 Goal 38 重复执行整套 Goal 37 场景',
    verification: 'Goal 38 只执行本场景，首次不改现场，第二次出现恢复后的草案',
    run: async (page) => {
      await page.getByRole('button', { name: '新建轮播单' }).click()
      await waitForText(page, ['当前工作区 · 轮播单'])

      await sendMessage(page, '模拟一次失败后继续')
      await waitForText(page, ['这次模型服务没有正常返回', '我还没有修改草案或播单'])

      await sendMessage(page, '模拟一次失败后继续')
      await waitForText(page, ['失败恢复后生成的草案', '确认前不会写入正式轮播单'])

      const lines = await bodyLines(page, /失败|恢复|草案|没有修改|轮播/)
      return {
        evidence: lines.slice(-22),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'react-create-draft-then-continue-research',
    description: 'ReAct 预置查证任务在用户说继续时接着原任务核验素材，不从头开始',
    run: async (page) => {
      await sendMessage(page, '新建一个1小时轮播单，先查世界杯亚洲球队素材再决定草案')
      await waitForText(page, ['当前工作区 · 轮播单', '世界杯亚洲球队素材', 'canonical 素材库核验素材方向'])

      await sendMessage(page, '继续')
      await waitForText(page, ['素材库', '已把“世界杯亚洲球队素材”更新到左侧草案的第 1 段', '正式播单还没有开始编排'])

      const lines = await bodyLines(page, /世界杯|素材|继续|更新草案|正式轮播单|ReAct|核验/)
      return {
        evidence: lines.slice(-22),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'fuzzy-atomic-insert-reacts-then-recommends',
    description: '模糊原子插入先 ReAct 查证素材，再给插入候选建议而不是更新草案或进入待选择',
    run: async (page) => {
      await page.getByRole('button', { name: '新建电视播单' }).click()
      await waitForText(page, ['当前工作区 · 电视播单'])

      await sendMessage(page, '9点插入一个与近期观众特别关心内容相关联的视频内容')
      await waitForText(page, ['现在还不能替你直接选其中一个', '你可以补充'])

      const lines = await bodyLines(page, /近期观众|素材|插入推荐|需选择|更新草案|正式播单|写入/)
      const text = await page.locator('body').innerText()
      if (text.includes('待确认更新草案')) {
        throw new Error('Fuzzy atomic insert should recommend insertion candidates, not update layout draft.')
      }
      if (text.includes('待确认插入节目') || text.includes('候选推荐')) {
        throw new Error('Fuzzy atomic insert should not open a candidate-selection pending panel.')
      }
      return {
        evidence: lines.slice(-22),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'rotation-atomic-insert-without-draft',
    description: '轮播单没有草案时，单条插入仍然走原子候选建议，不被整体编排门禁拦住',
    run: async (page) => {
      await page.getByRole('button', { name: '新建轮播单' }).click()
      await waitForText(page, ['当前工作区 · 轮播单'])

      await sendMessage(page, '9点插入看东方')
      await waitForText(page, ['看东方', '现在还不能替你直接选其中一个', '你可以补充'])
      const text = await page.locator('body').innerText()
      if (text.includes('这张轮播单还没有可用草案') || text.includes('待确认插入节目')) {
        throw new Error('Rotation atomic insert should not be blocked by draft gate or open candidate pending.')
      }

      const lines = await bodyLines(page, /轮播单|看东方|候选|插入|补充/)
      return {
        evidence: lines.slice(-18),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'rotation-queue-anchor-followup-and-relative-move',
    description: '轮播队列里已排节目后续插入、pending 位置补充和1点相对移动都按队列语义承接',
    run: async (page) => {
      await seedRotationSchedule(page, [
        { startTime: '00:00:00', endTime: '01:00:00', programName: '看东方111期新春特别行动', durationSeconds: 3600, programType: 'news' },
      ], { rotationDurationSeconds: 7200, rotationStrategy: 'content_match' })
      await waitForText(page, ['当前工作区 · 轮播单', '看东方111期新春特别行动'])

      await sendMessage(page, '继续插入一个看东方节目')
      await waitForText(page, ['还需要确认插在队列的哪个位置'])

      await sendMessage(page, '就在已插入的看东方节目后')
      await waitForText(page, ['看东方', '现在还不能替你直接选其中一个'])
      let text = await page.locator('body').innerText()
      if (text.includes('上一条待确认操作已失效')) {
        throw new Error('Position clarification should continue the pending insert, not expire it.')
      }
      if (text.includes('还需要补充插入节目的播出时间')) {
        throw new Error('Position clarification after an existing rotation item should resolve the insertion point.')
      }

      await sendMessage(page, '看东方后继续插入一个看东方节目')
      await waitForText(page, ['看东方', '现在还不能替你直接选其中一个'])
      text = await page.locator('body').innerText()
      if (text.includes('还需要补充插入节目的播出时间')) {
        throw new Error('Direct after-anchor rotation insert should not ask for a clock time.')
      }

      await sendMessage(page, '1点的看东方向后移动1小时')
      await waitForText(page, ['操作已完成', '+1小时'])
      text = await page.locator('body').innerText()
      if (text.includes('+13小时')) {
        throw new Error('Rotation move treated 1点 as +13小时 instead of a relative queue position.')
      }

      const lines = await bodyLines(page, /轮播单|看东方|候选|操作已完成|\+1小时|\+13小时|失效/)
      return {
        evidence: lines.slice(-28),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'rotation-clarification-time-correction-keeps-program',
    description: '轮播单插入补参时，用户只改时间，必须保留节目名并按轮播相对位置理解',
    run: async (page) => {
      await page.getByRole('button', { name: '新建轮播单' }).click()
      await waitForText(page, ['当前工作区 · 轮播单'])

      await sendMessage(page, '插入看东方')
      await waitForText(page, ['看东方'])
      const traceCount = await page.evaluate(() => (window.__AIBIANDAN_RUNTIME_TRACE__ ?? []).length)

      await sendMessage(page, '换成1点插入')
      await page.waitForFunction((previousCount) => (
        (window.__AIBIANDAN_RUNTIME_TRACE__ ?? []).length > previousCount
      ), traceCount, { timeout: 60_000 })
      await waitForText(page, ['看东方', '1点'])

      const text = await page.locator('body').innerText()
      if (text.includes('换成插入')) {
        throw new Error('Pending time correction polluted the programme hint as "换成插入".')
      }
      if (text.includes('上一条待确认操作已失效')) {
        throw new Error('Pending time correction should continue the pending insert, not expire it.')
      }

      if (text.includes('+13小时')) {
        throw new Error('Rotation time correction treated 1点 as +13小时 instead of a relative queue position.')
      }

      const runtimeTrace = await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? [])
      const traceText = JSON.stringify(runtimeTrace)
      if (!traceText.includes('看东方')) {
        throw new Error('Pending time correction lost the original programme hint.')
      }
      if (!traceText.includes('01:00:00') && !text.includes('1点')) {
        throw new Error('Rotation time correction did not keep the corrected 1点 position.')
      }

      const lines = await bodyLines(page, /轮播单|看东方|1点|插入|候选|确认|失效/)
      return {
        evidence: lines.slice(-20),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace,
      }
    },
  },
  {
    id: 'batch-delete-same-name-pending',
    description: '批量删除同名节目拆成复合原子任务，先列影响范围再确认',
    run: async (page) => {
      await seedTvSchedule(page, [
        { startTime: '07:00:00', endTime: '08:00:00', programName: '看东方 第112期', durationSeconds: 3600 },
        { startTime: '09:00:00', endTime: '09:45:00', programName: '看东方 第113期', durationSeconds: 2700 },
        { startTime: '19:30:00', endTime: '20:15:00', programName: '品质剧场 第9集', durationSeconds: 2700 },
      ])
      await waitForText(page, ['当前工作区 · 电视播单', '看东方 第112期', '看东方 第113期'])

      await sendMessage(page, '把全部看东方节目删除掉')
      await waitForText(page, ['删除', '看东方', '确认后我先删除'])

      const lines = await bodyLines(page, /删除|看东方|待确认|确认|影响范围|电视播单/)
      return {
        evidence: lines.slice(-22),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'tv-delete-time-range-large',
    description: '电视播单按大时间范围删除时分批确认，首批完成后保留剩余现场并继续',
    userInput: '把4点到10点全部节目删掉',
    expectedDecision: 'LLM 返回 time_range batch_delete 复合计划；本地首批最多10条，剩余2条沿 pending 继续',
    mustNotHappen: '确认前写入、一次性删除12条、删除范围外节目、继续时重复首批或失败后自动回滚',
    verification: '影响范围先进入确认；确认后 itemCount=2 且显示剩余2条；继续后 itemCount=0',
    run: async (page) => {
      const canonicalProducts = loadCanonicalScheduleProducts(12)
      const scheduleItems = canonicalProducts.map((product, index) => {
        const startMinutes = 4 * 60 + index * 30
        const endMinutes = startMinutes + 30
        const toClock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`
        return {
          id: product.productId,
          programCode: product.programCode,
          code18: product.programCode,
          programName: product.title,
          instanceName: product.title,
          startTime: toClock(startMinutes),
          endTime: toClock(endMinutes),
          durationSeconds: product.duration,
        }
      })
      await seedTvSchedule(page, scheduleItems)
      await waitForText(page, ['当前工作区 · 电视播单', canonicalProducts[0].title, canonicalProducts[11].title])

      await sendMessage(page, '把4点到10点全部节目删掉')
      await waitForText(page, ['04:00:00-10:00:00', '第 1 批', '确认后'])
      let state = await page.evaluate(() => window.__AIBIANDAN_PAGE_HARNESS__.getState())
      if (state.itemCount !== 12) {
        throw new Error(`Time-range delete mutated before confirmation; itemCount=${state.itemCount}.`)
      }

      await sendMessage(page, '确认')
      await waitForText(page, ['已先删除 10 条', '还剩 2 条'])
      state = await page.evaluate(() => window.__AIBIANDAN_PAGE_HARNESS__.getState())
      if (state.itemCount !== 2) {
        throw new Error(`First time-range batch should leave 2 items, got ${state.itemCount}.`)
      }

      await sendMessage(page, '继续')
      await waitForText(page, ['已删除 2 条', '已经没有这些目标节目'])
      state = await page.evaluate(() => window.__AIBIANDAN_PAGE_HARNESS__.getState())
      if (state.itemCount !== 0) {
        throw new Error(`Second time-range batch did not finish the scoped task; itemCount=${state.itemCount}.`)
      }

      const lines = await bodyLines(page, /04:00|10:00|删除|第 1 批|剩 2 条|确认|继续|没有这些目标节目/)
      return {
        evidence: lines.slice(-28),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'batch-delete-failure-can-retry',
    description: '批量删除写入失败后保留任务上下文，用户说继续可重试这一批',
    run: async (page) => {
      await seedTvSchedule(page, [
        { startTime: '07:00:00', endTime: '08:00:00', programName: '看东方 第112期', durationSeconds: 3600 },
        { startTime: '09:00:00', endTime: '09:45:00', programName: '看东方 第113期', durationSeconds: 2700 },
        { startTime: '19:30:00', endTime: '20:15:00', programName: '品质剧场 第9集', durationSeconds: 2700 },
      ])
      await waitForText(page, ['当前工作区 · 电视播单', '看东方 第112期', '看东方 第113期'])

      await sendMessage(page, '把全部看东方节目删除掉')
      await waitForText(page, ['删除', '看东方', '确认后我先删除'])
      await failNextAtomicReplaceAllItems(page, '浏览器回归模拟批量写入失败')
      await sendMessage(page, '确认')
      await waitForText(page, ['这批没有写入成功', '继续', '重试这一批'])

      await sendMessage(page, '继续')
      await waitForText(page, ['已删除 2 条', '已经没有这些目标节目'])

      const lines = await bodyLines(page, /删除|看东方|继续|重试|写入成功|没有这些目标节目|执行异常|执行完成/)
      return {
        evidence: lines.slice(-28),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
  {
    id: 'empty-workspace-atomic-needs-playlist',
    description: '没有播单工作区时直接发原子插入，必须引导先创建或打开播单',
    run: async (page) => {
      await sendMessage(page, '9点插入看东方')
      await waitForText(page, ['请先创建或打开一张电视播单或轮播单', '新建电视播单'])

      const lines = await bodyLines(page, /创建|打开|播单|插入|看东方/)
      return {
        evidence: lines.slice(-18),
        llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []),
        runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []),
      }
    },
  },
]

const clearBrowserStorage = async (page) => {
  await page.evaluate(() => {
    try {
      window.localStorage.clear()
      window.sessionStorage.clear()
    } catch {
      // ignore
    }
  })
  try {
    await page.evaluate(() => {
      return new Promise((resolve) => {
        try {
          const request = window.indexedDB.open('aibiandan-runtime-store')
          request.onsuccess = () => {
            const db = request.result
            Array.from(db.objectStoreNames).forEach((name) => {
              try {
                db.transaction(name, 'readwrite').objectStore(name).clear()
              } catch {
                // ignore
              }
            })
            resolve(undefined)
          }
          request.onerror = () => resolve(undefined)
          request.onblocked = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      })
    })
  } catch {
    // ignore
  }
}

const runScenario = async ({ chromium, url, scenario, executablePath }) => {
  const startTime = Date.now()
  goal37Log(`starting scenario: ${scenario.id}`)
  const launchOptions = {
    headless: true,
  }
  if (executablePath) {
    launchOptions.executablePath = executablePath
  }
  const browser = await chromium.launch(launchOptions)
  const context = await browser.newContext({ viewport: { width: 1500, height: 960 } })
  const page = await context.newPage()
  const consoleEvents = []
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() !== 'debug') {
      consoleEvents.push({ type: message.type(), text: message.text().slice(0, 500) })
    }
  })
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
  })

  try {
    await installBrowserLlmMock(page)
    await page.goto(url, { waitUntil: 'networkidle' })
    await clearBrowserStorage(page)
    const result = await scenario.run(page)
    goal37Log(`scenario passed: ${scenario.id} (${Date.now() - startTime}ms)`)
    return {
      id: scenario.id,
      description: scenario.description,
      status: 'passed',
      consoleEvents,
      pageErrors,
      ...result,
    }
  } catch (error) {
    const failurePayload = {
      id: scenario.id,
      description: scenario.description,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      consoleEvents,
      pageErrors,
      evidence: await bodyLines(page).then((lines) => lines.slice(-40)).catch(() => []),
      llmCalls: await page.evaluate(() => window.__goal37LlmCalls ?? []).catch(() => []),
      runtimeTrace: await page.evaluate(() => window.__AIBIANDAN_RUNTIME_TRACE__ ?? []).catch(() => []),
    }
    try {
      writeFileSync(path.join(rootDir, `goal37-debug-${scenario.id}.json`), JSON.stringify(failurePayload, null, 2), 'utf8')
    } catch {
      // ignore
    }
    goal37Log(`scenario failed: ${scenario.id} (${Date.now() - startTime}ms): ${error instanceof Error ? error.message : String(error)}`)
    return failurePayload
  } finally {
    await browser.close()
  }
}

const main = async () => {
  const args = new Set(process.argv.slice(2))
  const summaryOnly = args.has('--summary-only')
  const selectedId = process.argv.find((item) => item.startsWith('--scenario='))?.split('=')[1]
  const goalArg = process.argv.find((item) => item.startsWith('--goal='))?.split('=')[1]
  const goal = Number(goalArg ?? 37)
  const portArg = process.argv.find((item) => item.startsWith('--port='))?.split('=')[1]
  const port = Number(portArg ?? process.env.GOAL37_PORT ?? 5199)
  const goalScenarios = scenarios.filter((scenario) => (scenario.goals ?? [37]).includes(goal))
  const selected = selectedId ? scenarios.filter((scenario) => scenario.id === selectedId) : goalScenarios
  if (selected.length === 0) {
    throw new Error(selectedId ? `Unknown scenario: ${selectedId}` : `Unknown or empty browser goal: ${goal}`)
  }

  const server = args.has('--no-server')
    ? { url: `http://127.0.0.1:${port}/`, reused: true, stop: async () => undefined }
    : await startDevServer(port, { reuseExisting: args.has('--reuse-server') })
  const playwright = await resolvePlaywright()
  const executablePath = resolveChromiumExecutable()
  const results = []

  try {
    for (const scenario of selected) {
      results.push(await runScenario({
        chromium: playwright.chromium,
        url: server.url,
        scenario,
        executablePath,
      }))
    }
  } finally {
    await server.stop()
  }

  const summary = {
    goal,
    server: {
      url: server.url,
      reused: server.reused,
    },
    scenarioCount: results.length,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    results,
  }
  if (summaryOnly) {
    console.log(JSON.stringify({
      goal: summary.goal,
      server: summary.server,
      scenarioCount: summary.scenarioCount,
      passed: summary.passed,
      failed: summary.failed,
      results: results.map((result) => ({
        id: result.id,
        status: result.status,
        error: result.error,
      })),
    }, null, 2))
  } else {
    console.log(JSON.stringify(summary, null, 2))
  }

  if (summary.failed > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
