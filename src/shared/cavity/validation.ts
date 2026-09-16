/**
 * 库 / 模板校验（PRD-002 §7.2 规则清单 V1~V15）
 *
 * 纯函数，主进程（导入校验）与渲染层（保存前校验、行内提示）通用。
 * 级别：error 阻断保存；warning 仅提示。
 *
 * V12（PDF 文件可达性 / checksum）需要文件系统访问，由主进程在
 * 导入/保存时另行检查，此处不实现。
 */

import { TYPE_REGISTRY } from './cavityTypeRegistry'
import type { CavityLibrary, CavityTemplate, Step } from './types'

export type IssueLevel = 'error' | 'warning'

export interface ValidationIssue {
  /** 规则编号（V1~V15） */
  rule: string
  level: IssueLevel
  /** 人类可读描述 */
  message: string
  /** 关联模板 id */
  templateId: string
  /** 模板名称（便于列表展示） */
  templateName: string
  /** 数据路径（可选，用于行内定位） */
  path?: string
}

/* ---------- 台阶级校验 ---------- */

function validateSteps(t: CavityTemplate, issues: ValidationIssue[]): void {
  const steps = t.geometry.steps
  if (!steps || steps.length === 0) return

  if (steps.length < 1) {
    issues.push(err(t, 'R-S1', 'steps 至少包含 1 段', 'geometry.steps'))
  }

  steps.forEach((s: Step, i: number) => {
    const path = `geometry.steps[${i}]`
    if (!(s.diameter > 0)) {
      issues.push(err(t, 'V1', `第 ${i + 1} 段直径必须 > 0`, `${path}.diameter`))
    }
    // V3：length:null 仅允许出现在最后一段
    if (s.length == null && i !== steps.length - 1) {
      issues.push(err(t, 'V3', 'length:null（锥角收尖）仅允许出现在最后一段', `${path}.length`))
    }
    if (s.length != null && !(s.length > 0)) {
      issues.push(err(t, 'V1', `第 ${i + 1} 段段长必须 > 0`, `${path}.length`))
    }
    if (s.type === 'tapered') {
      if (s.angle == null) {
        issues.push(err(t, 'V1', `第 ${i + 1} 段为锥孔，必须填写锥角`, `${path}.angle`))
      } else if (!(s.angle > 0 && s.angle < 180)) {
        issues.push(err(t, 'V1', `第 ${i + 1} 段锥角需满足 0 < angle < 180（全角）`, `${path}.angle`))
      }
    }
    // V5：螺纹文本语法级警告
    if (s.thread) {
      const { family, designation } = s.thread
      if (!designation || !designation.trim()) {
        issues.push(warn(t, 'V5', `第 ${i + 1} 段螺纹标记为空`, `${path}.thread.designation`))
      } else {
        const prefix = designation.trim().toUpperCase()[0]
        const mismatch =
          (family === 'METRIC' && prefix !== 'M') ||
          (family === 'UN' && prefix !== 'U' && prefix !== '#') ||
          (family === 'NPT' && !prefix.startsWith('N')) ||
          (family === 'BSPP' && prefix !== 'G') ||
          (family === 'BSPT' && prefix !== 'R' && prefix !== 'P')
        if (mismatch) {
          issues.push(
            warn(
              t,
              'V5',
              `第 ${i + 1} 段螺纹系列（${family}）与标记文本「${designation}」前缀可能不匹配`,
              `${path}.thread.designation`
            )
          )
        }
      }
    }
  })

}

function err(t: CavityTemplate, rule: string, message: string, path?: string): ValidationIssue {
  return { rule, level: 'error', message, templateId: t.id, templateName: t.name, path }
}

function warn(t: CavityTemplate, rule: string, message: string, path?: string): ValidationIssue {
  return { rule, level: 'warning', message, templateId: t.id, templateName: t.name, path }
}

/* ---------- 模板级校验 ---------- */

export function validateTemplate(t: CavityTemplate): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const schema = TYPE_REGISTRY[t.cavityType]
  if (!schema) {
    issues.push(err(t, 'V6', `未知孔腔类型「${t.cavityType}」`, 'cavityType'))
    return issues
  }
  const a = schema.allowed
  const g = t.geometry

  // 单位校验（FR-03-38 / R-U1）
  if (!t.unit || (t.unit !== 'mm' && t.unit !== 'in')) {
    issues.push(err(t, 'FR-03-38', '模板单位必须声明为 mm 或 in', 'unit'))
  }

  // V6：字段矩阵 —— 不允许的子结构不得出现
  if (!a.steps && g.steps) issues.push(err(t, 'V6', `${schema.label}不允许包含台阶序列（组合孔为纯容器）`, 'geometry.steps'))
  if (!a.ports && g.ports && g.ports.length > 0) issues.push(err(t, 'V6', `${schema.label}不允许包含侧油口`, 'geometry.ports'))
  if (!a.layout && g.layout) issues.push(err(t, 'V6', `${schema.label}不允许包含布局（layout）`, 'geometry.layout'))
  if (!a.outline && g.outline) issues.push(err(t, 'V6', `${schema.label}不允许包含安装轮廓（outline）`, 'geometry.outline'))
  if (!a.plug && g.plug) issues.push(err(t, 'V6', `${schema.label}不允许包含螺堵（plug）`, 'geometry.plug'))
  if (!a.locatingShoulder && g.locatingShoulder)
    issues.push(err(t, 'V6', `${schema.label}不允许包含定位肩`, 'geometry.locatingShoulder'))
  if (!a.thread) {
    const bad = (g.steps ?? []).some((s) => s.thread != null)
    if (bad) issues.push(err(t, 'V6', `${schema.label}不允许包含螺纹`, 'geometry.steps'))
  }

  // V7：holes 存在性
  if (a.holes) {
    if (!Array.isArray(t.holes)) {
      issues.push(err(t, 'V7', '组合孔必须有 holes 字段（可为空数组）', 'holes'))
    }
  } else if ('holes' in t && t.holes !== undefined) {
    issues.push(err(t, 'V7', '非组合孔不得包含 holes 字段', 'holes'))
  }

  // 组合孔 outline path 非空（当 type 为 'none' 时为空为正常配置，不告警）
  // data 在旧数据/编辑中间态可能为 null，需防御；预览层同用途处用 ?? '' 归并
  if (
    a.outline &&
    g.outline &&
    g.outline.type !== 'none' &&
    g.outline.shapeType !== 'none' &&
    !(g.outline.data ?? '').trim()
  ) {
    issues.push(warn(t, 'V9', '安装轮廓 path 为空，预览将仅显示子孔', 'geometry.outline.data'))
  }

  if (a.steps) validateSteps(t, issues)

  // 子孔引用：坐标/名称基本合法性
  if (t.holes) {
    t.holes.forEach((h, i) => {
      if (!h.name?.trim()) {
        issues.push(err(t, 'V8', `子孔 ${i + 1} 缺少名称`, `holes[${i}].name`))
      }
      const inline = h.ref == null
      if (!inline) {
        if (!h.ref?.templateId) {
          issues.push(err(t, 'V8', `子孔「${h.name}」引用缺少模板 id`, `holes[${i}].ref.templateId`))
        }
      } else if (!h.cavityType || !h.geometry) {
        issues.push(err(t, 'V8', `内联子孔「${h.name}」缺少类型或几何定义`, `holes[${i}].geometry`))
      } else {
        const hAllowed = TYPE_REGISTRY[h.cavityType]?.allowed
        if (!hAllowed?.ports && h.geometry.ports && h.geometry.ports.length > 0) {
          issues.push(err(t, 'V6', `子孔「${h.name}」（${TYPE_REGISTRY[h.cavityType]?.label}）不允许包含侧油口`, `holes[${i}].geometry.ports`))
        } else if (hAllowed?.ports && h.geometry.ports) {
          h.geometry.ports.forEach((p, pi) => {
            const pPath = `holes[${i}].geometry.ports[${pi}]`
            if (!(p.depth >= 0)) {
              issues.push(err(t, 'FR-03-60', `子孔「${h.name}」侧油口 ${pi + 1} 深度位置需 >= 0`, `${pPath}.depth`))
            }
            if (!p.isBottomPort && (p.diameter == null || !(p.diameter > 0))) {
              issues.push(err(t, 'FR-03-60', `子孔「${h.name}」非通底侧油口 ${pi + 1} 直径需 > 0`, `${pPath}.diameter`))
            }
          })
        }
      }
    })
    // 子孔名唯一
    const names = new Set<string>()
    for (const h of t.holes) {
      if (names.has(h.name)) {
        issues.push(err(t, 'V8', `子孔名「${h.name}」重复`, 'holes'))
      }
      names.add(h.name)
    }
  }

  // 侧油口校验
  if (a.ports && g.ports) {
    g.ports.forEach((p, i) => {
      const pPath = `geometry.ports[${i}]`
      if (!(p.depth >= 0)) {
        issues.push(err(t, 'FR-03-60', `侧油口 ${i + 1} 深度位置需 >= 0`, `${pPath}.depth`))
      }
      if (!p.isBottomPort && (p.diameter == null || !(p.diameter > 0))) {
        issues.push(err(t, 'FR-03-60', `非通底侧油口 ${i + 1} 直径需 > 0`, `${pPath}.diameter`))
      }
    })
  }

  // 元件包围盒 V14/V15
  const boxNames = new Set<string>()
  for (const b of t.componentBoxes ?? []) {
    if (!b.name?.trim()) {
      issues.push(err(t, 'V14', '包围盒名称不能为空', 'componentBoxes'))
    } else if (boxNames.has(b.name.trim())) {
      issues.push(err(t, 'V14', `包围盒名称「${b.name}」重复`, 'componentBoxes'))
    } else {
      boxNames.add(b.name.trim())
    }

    if (b.shape === 'box') {
      if (!(b.size.x > 0 && b.size.y > 0 && b.size.z > 0)) {
        issues.push(err(t, 'V14', `包围盒「${b.name}」尺寸需全部 > 0`, 'componentBoxes'))
      }
      if (!(b.size.z > 0)) {
        issues.push(err(t, 'V15', `包围盒「${b.name}」悬伸高度需 > 0 并向外`, 'componentBoxes'))
      }
    } else if (b.shape === 'cylinder') {
      if (!(b.diameter > 0 && b.height > 0)) {
        issues.push(err(t, 'V14', `包围盒「${b.name}」直径与高度需 > 0`, 'componentBoxes'))
      }
      if (!(b.height > 0)) {
        issues.push(err(t, 'V15', `包围盒「${b.name}」悬伸高度需 > 0 并向外`, 'componentBoxes'))
      }
    }
  }

  // 参考文档 V11/V13
  for (const ref of t.references ?? []) {
    if (ref.kind === 'pdf') {
      if (!ref.path?.trim()) {
        issues.push(err(t, 'V11', `参考文档「${ref.title || '未命名'}」缺少文件路径`, 'references'))
      }
    } else if (ref.kind === 'url') {
      if (!ref.url?.trim()) {
        issues.push(err(t, 'V11', `参考文档「${ref.title || '未命名'}」缺少链接地址`, 'references'))
      }
    }
    if (ref.pageStart != null && ref.pageStart < 1) {
      issues.push(err(t, 'V13', `参考文档「${ref.title || '未命名'}」起始页需 >= 1`, 'references'))
    }
    if (ref.pageStart != null && ref.pageEnd != null && ref.pageEnd < ref.pageStart) {
      issues.push(err(t, 'V13', `参考文档「${ref.title || '未命名'}」结束页不得小于起始页`, 'references'))
    }
  }

  // 标注信息基本语法校验
  if (t.annotation?.template) {
    const tmpl = t.annotation.template
    const openCount = (tmpl.match(/</g) || []).length
    const closeCount = (tmpl.match(/>/g) || []).length
    if (openCount !== closeCount) {
      issues.push(warn(t, 'V5', '标注模板尖括号未闭合（如 <MOD-DIAM>）', 'annotation.template'))
    }
  }

  return issues
}

/* ---------- 库级校验 ---------- */

export function validateLibrary(lib: CavityLibrary): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const categoryIds = new Set<string>()
  const walk = (nodes: CavityLibrary['categories']): void => {
    for (const n of nodes) {
      if (categoryIds.has(n.id)) {
        issues.push({
          rule: 'V4',
          level: 'error',
          message: `分类节点 id 重复：${n.id}`,
          templateId: '',
          templateName: lib.name
        })
      }
      categoryIds.add(n.id)
      walk(n.children)
    }
  }
  walk(lib.categories)

  // V4：同分类下模板名唯一
  const nameByCategory = new Map<string, Set<string>>()
  for (const t of lib.templates) {
    if (!categoryIds.has(t.categoryId)) {
      issues.push({
        rule: 'V8',
        level: 'error',
        message: `模板「${t.name}」挂载的分类不存在（categoryId=${t.categoryId}）`,
        templateId: t.id,
        templateName: t.name
      })
    }
    let names = nameByCategory.get(t.categoryId)
    if (!names) {
      names = new Set()
      nameByCategory.set(t.categoryId, names)
    }
    if (names.has(t.name)) {
      issues.push({
        rule: 'V4',
        level: 'error',
        message: `分类下模板名重复：「${t.name}」`,
        templateId: t.id,
        templateName: t.name
      })
    }
    names.add(t.name)
    issues.push(...validateTemplate(t))
  }

  return issues
}

/** 是否存在阻断级错误 */
export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === 'error')
}
