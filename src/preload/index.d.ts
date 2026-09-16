import type { UpdaterApi, SettingsApi, Api, WindowControls, LibraryApi, ProjectApi, FileApi } from './index'

declare global {
  interface Window {
    updaterApi: UpdaterApi
    settingsApi: SettingsApi
    api: Api
    windowControls: WindowControls
    libraryApi: LibraryApi
    projectApi: ProjectApi
    fileApi: FileApi
  }
}

export {}
