import React, { useEffect } from 'react'
import ConnectorsTabPanel from '../tabs/ConnectorsTabPanel'
import { openPanelByType } from '../registry/panelActions'

export interface CadConnectorMarketModalProps {
  open: boolean
  onClose: () => void
}

/**
 * 兼容层：原 Modal 弹窗已升级为原生工作区 Tab 面板（ConnectorsTabPanel）。
 * 若接收到 open=true，将无缝转为激活 CAD 连接器工作区 Tab。
 */
export const CadConnectorMarketModal: React.FC<CadConnectorMarketModalProps> = ({ open, onClose }) => {
  useEffect(() => {
    if (open) {
      openPanelByType('connectors')
      onClose()
    }
  }, [open, onClose])

  return null
}

export { ConnectorsTabPanel }
export default ConnectorsTabPanel
