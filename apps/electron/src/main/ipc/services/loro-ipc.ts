import { IpcMethod, IpcService } from 'electron-ipc-decorator'
import { getIpcServiceDeps } from '../ipc-service-deps'

export class LoroIpc extends IpcService {
  static override readonly groupName = 'loro'

  @IpcMethod()
  async isConnected() {
    return getIpcServiceDeps().loroDataPlaneRelay.isConnected()
  }

  @IpcMethod()
  async getRemoteServerUrl(): Promise<string> {
    return getIpcServiceDeps().loroDataPlaneRelay.getRemoteServer()
  }

  @IpcMethod()
  async setRemoteServerUrl(url: string): Promise<{ success: boolean }> {
    getIpcServiceDeps().loroDataPlaneRelay.setRemoteServer(url)
    return { success: true }
  }
}
