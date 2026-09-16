/**
 * 命令系统（MVVM 的可撤销操作单元）
 *
 * 所有用户操作（属性修改 / 结构增删 / 排序 / 选中变更）统一表达为 Command：
 * - apply(draft)：在 immer draft 上执行变更（只允许改 doc / selection）
 * - invert()：返回逆命令，undo 时直接执行
 *
 * 约定：视图组件禁止直接修改 store 内文档，必须经 execute(command)，
 * 以保证撤销/重做后界面与数据严格一致。
 */

import { setIn } from '../model/documentOps'

/** 命令作用目标：store state 中可被命令变更的部分 */
export interface CommandTarget {
  doc: unknown
  selection: unknown
}

export interface Command {
  /** 人类可读操作名（undo 提示 / 调试） */
  readonly label: string
  /** 是否影响文档内容（决定脏标记） */
  readonly affectsDoc: boolean
  /** 连续合并键（防抖窗口内同 key 的命令合并为一步）；undefined 不合并 */
  readonly mergeKey?: string
  apply(d: CommandTarget): void
  invert(): Command
}

/* ---------- 属性修改 ---------- */

export class UpdateCmd implements Command {
  constructor(
    readonly path: string,
    private readonly next: unknown,
    private readonly prev: unknown,
    readonly label = '修改属性',
    readonly affectsDoc = true,
    readonly mergeKey: string | undefined = `update:${path}`
  ) {}

  apply(d: CommandTarget): void {
    setIn(d as unknown as Record<string, unknown>, this.path, this.next)
  }

  invert(): Command {
    return new UpdateCmd(this.path, this.prev, this.next, this.label, this.affectsDoc)
  }

  /** 合并：保留最早的 prev，采用最新 next */
  mergeWith(newer: UpdateCmd): UpdateCmd {
    return new UpdateCmd(this.path, newer.next, this.prev, this.label, this.affectsDoc)
  }
}

/* ---------- 数组增删（互逆） ---------- */

function arr(target: CommandTarget, arrayPath: string, createIfMissing = false): unknown[] {
  const segs = arrayPath.split('.')
  let cur: unknown = target
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (cur == null) throw new Error(`命令路径失效：${arrayPath}`)
    if (i === segs.length - 1) {
      if (createIfMissing && (cur as Record<string, unknown>)[s] == null) {
        ;(cur as Record<string, unknown>)[s] = []
      }
    } else if (createIfMissing && (cur as Record<string, unknown>)[s] == null) {
      ;(cur as Record<string, unknown>)[s] = /^\d+$/.test(segs[i + 1]) ? [] : {}
    }
    cur = (cur as Record<string, unknown>)[s]
  }
  if (!Array.isArray(cur)) throw new Error(`命令目标不是数组：${arrayPath}`)
  return cur
}

export class InsertCmd implements Command {
  readonly affectsDoc = true
  constructor(
    readonly arrayPath: string,
    readonly index: number,
    readonly item: unknown,
    readonly label = '新增'
  ) {}

  apply(d: CommandTarget): void {
    arr(d, this.arrayPath, true).splice(this.index, 0, this.item)
  }

  invert(): Command {
    return new RemoveCmd(this.arrayPath, this.index, this.item, this.label)
  }
}

export class RemoveCmd implements Command {
  readonly affectsDoc = true
  constructor(
    readonly arrayPath: string,
    readonly index: number,
    readonly item: unknown,
    readonly label = '删除'
  ) {}

  apply(d: CommandTarget): void {
    arr(d, this.arrayPath).splice(this.index, 1)
  }

  invert(): Command {
    return new InsertCmd(this.arrayPath, this.index, this.item, this.label)
  }
}

/* ---------- 数组内移动（排序） ---------- */

export class MoveCmd implements Command {
  readonly affectsDoc = true
  constructor(
    readonly arrayPath: string,
    readonly from: number,
    readonly to: number,
    readonly label = '调整顺序'
  ) {}

  apply(d: CommandTarget): void {
    const a = arr(d, this.arrayPath)
    const [it] = a.splice(this.from, 1)
    a.splice(this.to, 0, it)
  }

  invert(): Command {
    return new MoveCmd(this.arrayPath, this.to, this.from, this.label)
  }
}

/* ---------- 选中变更（入 undo 栈，但不置脏） ---------- */

export class SelectionCmd implements Command {
  readonly affectsDoc = false
  readonly mergeKey = 'selection'
  constructor(
    private readonly prev: unknown,
    private readonly next: unknown,
    readonly label = '切换选中'
  ) {}

  apply(d: CommandTarget): void {
    setIn(d as unknown as Record<string, unknown>, 'selection', this.next)
  }

  invert(): Command {
    return new SelectionCmd(this.next, this.prev, this.label)
  }

  mergeWith(newer: SelectionCmd): SelectionCmd {
    return new SelectionCmd(this.prev, newer.next, this.label)
  }
}

/* ---------- 组合命令（一次操作 = 多个原子命令） ---------- */

export class CompositeCmd implements Command {
  readonly affectsDoc: boolean
  constructor(
    readonly label: string,
    private readonly cmds: Command[]
  ) {
    this.affectsDoc = cmds.some((c) => c.affectsDoc)
  }

  apply(d: CommandTarget): void {
    for (const c of this.cmds) c.apply(d)
  }

  invert(): Command {
    return new CompositeCmd(
      this.label,
      [...this.cmds].reverse().map((c) => c.invert())
    )
  }
}

/* ---------- 树结构重组命令（拖拽排序与层级迁移） ---------- */

export class ReorganizeDocCmd implements Command {
  readonly affectsDoc = true
  constructor(
    private readonly prevDoc: any,
    private readonly nextDoc: any,
    readonly label = '调整树结构'
  ) {}

  apply(d: CommandTarget): void {
    ;(d as { doc: any }).doc = this.nextDoc
  }

  invert(): Command {
    return new ReorganizeDocCmd(this.nextDoc, this.prevDoc, this.label)
  }
}

