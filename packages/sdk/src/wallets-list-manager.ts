import { FetchWalletsError } from 'src/errors/wallets-manager/fetch-wallets.error';
import {
    WalletInfoRemote,
    WalletInfoInjectable,
    WalletInfo,
    WalletInfoDTO,
    isWalletInfoCurrentlyEmbedded,
    WalletInfoCurrentlyEmbedded
} from 'src/models/wallet/wallet-info';
import { InjectedProvider } from 'src/provider/injected/injected-provider';

export class WalletsListManager {
    private walletsListCache: Promise<WalletInfo[]> | null = null;

    private readonly walletsListSource: string =
        'https://raw.githubusercontent.com/ton-connect/wallets-list/main/wallets.json';

    constructor(walletsListSource?: string) {
        if (walletsListSource) {
            this.walletsListSource = walletsListSource;
        }
    }

    public async getWallets(): Promise<WalletInfo[]> {
        if (!this.walletsListCache) {
            this.walletsListCache = this.fetchWalletsList();
            this.walletsListCache.catch(() => (this.walletsListCache = null));
        }

        return this.walletsListCache;
    }

    public async getEmbeddedWallet(): Promise<WalletInfoCurrentlyEmbedded | null> {
        const walletsList = await this.getWallets();
        const embeddedWallets = walletsList.filter(isWalletInfoCurrentlyEmbedded);

        if (embeddedWallets.length !== 1) {
            return null;
        }

        return embeddedWallets[0]!;
    }

    private async fetchWalletsList(): Promise<WalletInfo[]> {
        try {
            const walletsResponse = await fetch(this.walletsListSource);
            const walletsList: WalletInfoDTO[] = await walletsResponse.json();

            if (
                !Array.isArray(walletsList) ||
                !walletsList.every(wallet => this.isCorrectWalletConfigDTO(wallet))
            ) {
                throw new FetchWalletsError('Wrong wallets list format');
            }

            const currentlyInjectedWallets = InjectedProvider.getCurrentlyInjectedWallets();

            return this.mergeWalletsLists(
                this.walletConfigDTOListToWalletConfigList(walletsList),
                currentlyInjectedWallets
            );
        } catch (e) {
            throw new FetchWalletsError(e);
        }
    }

    private walletConfigDTOListToWalletConfigList(walletConfigDTO: WalletInfoDTO[]): WalletInfo[] {
        return walletConfigDTO.map(walletConfigDTO => {
            const walletConfig: WalletInfo = {
                name: walletConfigDTO.name,
                imageUrl: walletConfigDTO.image,
                aboutUrl: walletConfigDTO.about_url,
                tondns: walletConfigDTO.tondns
            } as WalletInfo;

            walletConfigDTO.bridge.forEach(bridge => {
                if (bridge.type === 'sse') {
                    (walletConfig as WalletInfoRemote).bridgeUrl = bridge.url;
                    (walletConfig as WalletInfoRemote).universalLink =
                        walletConfigDTO.universal_url;
                    (walletConfig as WalletInfoRemote).deepLink = walletConfigDTO.deepLink;
                }

                if (bridge.type === 'js') {
                    const jsBridgeKey = bridge.key;
                    (walletConfig as WalletInfoInjectable).jsBridgeKey = jsBridgeKey;
                    (walletConfig as WalletInfoInjectable).injected =
                        InjectedProvider.isWalletInjected(jsBridgeKey);
                    (walletConfig as WalletInfoInjectable).embedded =
                        InjectedProvider.isInsideWalletBrowser(jsBridgeKey);
                }
            });

            return walletConfig;
        });
    }

    private mergeWalletsLists(list1: WalletInfo[], list2: WalletInfo[]): WalletInfo[] {
        const names = new Set(list1.concat(list2).map(item => item.name));

        return [...names.values()].map(name => {
            const list1Item = list1.find(item => item.name === name);
            const list2Item = list2.find(item => item.name === name);

            return {
                ...(list1Item && { ...list1Item }),
                ...(list2Item && { ...list2Item })
            } as WalletInfo;
        });
    }

    private isCorrectWalletConfigDTO(value: unknown): value is WalletInfoDTO {
        if (!value || !(typeof value === 'object')) {
            return false;
        }

        const containsName = 'name' in value;
        const containsImage = 'image' in value;
        const containsAbout = 'about_url' in value;

        if (!containsName || !containsImage || !containsAbout) {
            return false;
        }

        if (
            !('bridge' in value) ||
            !Array.isArray((value as { bridge: unknown }).bridge) ||
            !(value as { bridge: unknown[] }).bridge.length
        ) {
            return false;
        }

        const bridge = (value as { bridge: unknown[] }).bridge;

        if (bridge.some(item => !item || typeof item !== 'object' || !('type' in item))) {
            return false;
        }

        const sseBridge = bridge.find(item => (item as { type: string }).type === 'sse');

        if (sseBridge) {
            if (
                !('url' in sseBridge) ||
                !(sseBridge as { url: string }).url ||
                !(value as { universal_url: string }).universal_url
            ) {
                return false;
            }
        }

        const jsBridge = bridge.find(item => (item as { type: string }).type === 'js');

        if (jsBridge) {
            if (!('key' in jsBridge) || !(jsBridge as { key: string }).key) {
                return false;
            }
        }

        return true;
    }
}
