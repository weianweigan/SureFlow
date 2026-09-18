import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 通用浏览 Tab 面板组件（ViewerTabPanel）
 * 承载 PDF 文档、网页、图片以及 CAD (STEP/GLB) 模型的统一浏览
 */
import { useEffect, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import type { TabParams } from '../registry/tabTypeRegistry'
import { CadModelViewer } from './viewer/CadModelViewer'
import { PdfViewer } from './viewer/PdfViewer'
import { ImageViewer } from './viewer/ImageViewer'
import { WebBrowserViewer } from './viewer/WebBrowserViewer'

export default function ViewerTabPanel(props: IDockviewPanelProps<TabParams>) {
  _useLocale()
  const [params, setParams] = useState<TabParams>(props.params as TabParams)

  useEffect(() => {
    const disposable = props.api.onDidParametersChange((event) => {
      setParams(event as TabParams)
    })
    return () => disposable.dispose()
  }, [props.api])
  if (params.kind !== 'viewer') {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
        {_t("未指定浏览目标")}</div>
    )
  }

  const { subType, target, libraryDirPath, pageStart, pageEnd, referenceIndex, referenceBasePath } = params

  switch (subType) {
    case 'cad':
      return <CadModelViewer target={target} libraryDirPath={libraryDirPath} />
    case 'pdf':
      return (
        <PdfViewer
          target={target}
          libraryDirPath={libraryDirPath}
          pageStart={pageStart}
          pageEnd={pageEnd}
          referenceIndex={referenceIndex}
          referenceBasePath={referenceBasePath}
        />
      )
    case 'image':
      return <ImageViewer target={target} libraryDirPath={libraryDirPath} />
    case 'url':
    default:
      return <WebBrowserViewer target={target} />
  }
}
