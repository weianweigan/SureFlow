import { useState, type FC } from 'react'
import { X, ExternalLink, ShieldCheck, FileText, Code2, Copy, Check } from 'lucide-react'
import { useLocale } from '@renderer/i18n/useLocale'
import { t } from '@shared/i18n'
import { Button } from './ui/button'
import { version } from '../../../../package.json'

interface AboutDialogProps {
  isOpen: boolean
  onClose: () => void
}

const LICENSE_TEXT = `SureFlow Source-Available & Personal Non-Commercial License
Version 1.0 (2026)

Copyright (c) 2026 SureFlow Team. All Rights Reserved.
版权所有 (c) 2026 SureFlow 团队。保留所有权利。

================================================================================
TERMS AND CONDITIONS (许可条款与条件)
================================================================================

1. GRANT OF LICENSE (许可授予)
Subject to the terms and restrictions set forth in this License, the Licensor 
grants you a limited, personal, revocable, non-exclusive, non-transferable, 
royalty-free license to download, view, compile, and run the source code solely 
for individual non-commercial study, learning, evaluation, and non-commercial 
research purposes on your personal devices.

2. COMMERCIAL USE RESTRICTIONS (严格禁止商业使用)
Commercial use of this Software, its source code, compiled binaries, or any of 
its assets, in whole or in part, is STRICTLY PROHIBITED without prior explicit 
written permission from the Licensor.
Commercial use includes, but is not limited to:
  (a) Using this Software or any of its outputs directly or indirectly to produce 
      commercial valve blocks, generate commercial revenue, or provide commercial 
      engineering/design services;
  (b) Installing or utilizing this Software in any corporate, commercial enterprise, 
      business entity, or commercial production environment;
  (c) Renting, leasing, licensing, sublicensing, selling, or charging fees for 
      access to this Software or any derivative software.

3. PROHIBITION OF MODIFICATION & REDISTRIBUTION (禁止修改再分发)
  (a) NO REDISTRIBUTION: You may NOT redistribute, publish, mirror, host, 
      sub-license, or convey copies of this Software (in either source code or 
      binary forms) to any third party or public repository.
  (b) NO DERIVATIVE WORKS: You may NOT distribute, publish, or release modified 
      versions, forks, or derivative works based on this Software or any of its 
      code. Any personal modification must remain strictly local and private for 
      individual study.

4. SPECIAL PROTECTION FOR CAVITY LIBRARIES (孔腔库专有保护条款)
The built-in and packaged hydraulic Cavity Libraries (including but not limited to 
3D CAD models, STEP/BREP data, cavity cross-section geometries, parameter schemas, 
metadata and JSON/YAML definitions located under "resources/builtin-libraries", 
".sfzip" files, or generated caches) are proprietary and confidential engineering assets 
of the Licensor:
  (a) INDEPENDENT RETENTION OF OWNERSHIP: The Licensor retains full, exclusive, 
      and unencumbered worldwide intellectual property rights, database rights, 
      and ownership over the Cavity Libraries.
  (b) NO SEPARATE COMMERCIAL USE OR EXTRACTION: You shall NOT extract, scrape, 
      decouple, export, reverse-engineer, convert, or repackage the Cavity Libraries 
      for use outside of this Software, nor use them as a database/plug-in for any 
      other CAD/CAM/hydraulic design software.
  (c) NO RESALE OR COMMERCIAL SHARING: The Cavity Libraries shall NOT be sold, 
      bundled, traded, or utilized for commercial hydraulic tooling, manufacturing, 
      or catalog services.

5. THIRD-PARTY NOTICES (第三方开源组件声明)
This Software incorporates certain third-party open-source components (e.g., 
Electron, React, Three.js, Manifold-3D, Open CASCADE WebAssembly wrappers, etc.). 
Each third-party component is governed by its respective open-source license.

6. DISCLAIMER OF WARRANTY (免责声明)
THE SOFTWARE AND CAVITY LIBRARIES ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY 
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF 
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.`

const THIRD_PARTY_PACKAGES = [
  { name: 'React & React DOM', license: 'MIT', desc: '用于构建响应式用户界面的前端基础框架', author: 'Meta Platforms, Inc.' },
  { name: 'Three.js & @react-three/fiber', license: 'MIT', desc: 'WebGL 3D 场景图渲染与声明式三维渲染管道', author: 'Three.js Authors / Poimandres' },
  { name: 'Manifold-3D', license: 'Apache-2.0', desc: '工业级高鲁棒性流形实体构造实体几何 (CSG) 内核', author: 'The Manifold Authors' },
  { name: 'Open CASCADE (OCCT via @bitbybit-dev/occt)', license: 'LGPL-2.1 / MIT', desc: '高精度工业级边界表示 (B-Rep) 几何内核与 STEP 交换', author: 'Bit by bit dev / Open CASCADE SAS' },
  { name: 'Electron & electron-builder', license: 'MIT', desc: '跨平台独立桌面客户端框架与安全容器', author: 'OpenJS Foundation' },
  { name: 'Zustand & Immer', license: 'MIT', desc: '轻量响应式状态管理与不可变数据流更新', author: 'Paul Henschel / Michel Weststrate' },
  { name: 'Konva & react-konva', license: 'MIT', desc: '2D 高性能图纸草图绘制与尺寸标注画布引擎', author: 'Anton Lavrenov' },
  { name: 'Dockview', license: 'MIT', desc: '专业桌面 CAD 式多标签页与灵活分栏停靠布局系统', author: 'Dan Williams' },
  { name: 'TailwindCSS & Radix UI', license: 'MIT', desc: '无障碍交互组件原语与现代化工业界面设计系统', author: 'Tailwind Labs / WorkOS' },
  { name: 'Lucide Icons', license: 'ISC', desc: '界面矢量图标库', author: 'Lucide Project' },
  { name: 'Inter & JetBrains Mono', license: 'OFL-1.1', desc: '界面排版与等宽工程参数字体', author: 'Rasmus Andersson / JetBrains s.r.o.' },
  { name: 'React PDF Viewer', license: 'MIT', desc: '用于预览和阅读 PDF 格式文档及样本', author: 'react-pdf-viewer' }
]

export const AboutDialog: FC<AboutDialogProps> = ({ isOpen, onClose }) => {
  useLocale()
  const [activeTab, setActiveTab] = useState<'license' | 'third-party'>('license')
  const [copied, setCopied] = useState(false)

  if (!isOpen) return null

  const handleCopyLicense = () => {
    void navigator.clipboard.writeText(LICENSE_TEXT).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleOpenExternal = (url: string) => {
    if (window.api?.openExternal) {
      void window.api.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-2xl max-h-[85vh] rounded-xl border border-border bg-card shadow-2xl text-card-foreground overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
              <img
                src={`${import.meta.env.BASE_URL}logo.svg`}
                alt="SureFlow Logo"
                className="size-6 object-contain"
                onError={(e) => {
                  // Fallback 图标
                  e.currentTarget.src = `${import.meta.env.BASE_URL}Icon.svg`
                }}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight text-foreground">SureFlow</h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium font-mono bg-primary/10 text-primary border border-primary/25">
                  v{version} Preview
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('液压阀块设计软件 - 基于 Electron + React + React Three Fiber 的独立桌面应用')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
            aria-label={t('关闭')}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Tab 导航 */}
        <div className="flex items-center px-6 border-b border-border bg-muted/10 gap-1 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('license')}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'license'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <ShieldCheck className="size-3.5" />
            <span>{t('软件许可')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('third-party')}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'third-party'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Code2 className="size-3.5" />
            <span>{t('第三方开源内容')}</span>
          </button>
        </div>

        {/* 主体滚动区 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs leading-relaxed">
          {activeTab === 'license' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground flex items-center gap-1.5">
                  <FileText className="size-3.5 text-muted-foreground" />
                  <span>{t('许可协议文本 (LICENSE)')}</span>
                </span>
                <button
                  type="button"
                  onClick={handleCopyLicense}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="size-3 text-emerald-500" />
                      <span className="text-emerald-500">{t('已复制')}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="size-3" />
                      <span>{t('复制文本')}</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-4 rounded-lg border border-border bg-muted/30 font-mono text-[11px] text-muted-foreground overflow-y-auto max-h-[50vh] leading-relaxed whitespace-pre-wrap select-text">
                {LICENSE_TEXT}
              </pre>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 rounded-lg border border-border bg-muted/20 text-muted-foreground text-[11px]">
                {t('SureFlow 依赖并受益于优秀的开源生态。以下列出构建本软件所采用的核心第三方开源库及授权协议。各库原作者保留其相应著作权：')}
              </div>

              <div className="divide-y divide-border rounded-lg border border-border bg-background overflow-hidden">
                {THIRD_PARTY_PACKAGES.map((pkg) => (
                  <div key={pkg.name} className="p-3 flex items-start justify-between gap-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{pkg.name}</span>
                        <span className="px-1.5 py-0.2 rounded bg-muted text-[10px] font-mono text-muted-foreground border border-border">
                          {pkg.license}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-[11px]">{t(pkg.desc)}</p>
                      <p className="text-[10px] text-muted-foreground/70">{pkg.author}</p>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-muted-foreground">
                {t('详细的第三方开源协议全文请参见项目仓库根目录下的 THIRD_PARTY_LICENSES.md 文件。')}
              </p>
            </div>
          )}
        </div>

        {/* 底部操作与外链栏 */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-muted/20">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <button
              type="button"
              onClick={() => handleOpenExternal('https://github.com/weianweigan/SureFlow')}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
            >
              <span>GitHub</span>
              <ExternalLink className="size-3" />
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => handleOpenExternal('https://github.com/weianweigan/SureFlow/issues')}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
            >
              <span>{t('问题反馈')}</span>
              <ExternalLink className="size-3" />
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => handleOpenExternal('https://github.com/weianweigan/SureFlow/discussions')}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
            >
              <span>{t('交流讨论')}</span>
              <ExternalLink className="size-3" />
            </button>
          </div>

          <Button size="sm" onClick={onClose} className="cursor-pointer">
            {t('确定')}
          </Button>
        </div>
      </div>
    </div>
  )
}
