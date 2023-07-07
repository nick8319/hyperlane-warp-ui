import { useConnectModal as useEvmodal } from '@rainbow-me/rainbowkit';
import { useConnection, useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { useWalletModal as useSolanaModal } from '@solana/wallet-adapter-react-ui';
import { Connection as SolConnection, clusterApiUrl } from '@solana/web3.js';
import {
  sendTransaction as sendEvmTransaction,
  switchNetwork as switchEvmNetwork,
} from '@wagmi/core';
import { providers } from 'ethers';
import { useCallback, useEffect, useMemo } from 'react';
import { toast } from 'react-toastify';
import {
  useAccount as useEvmAccount,
  useDisconnect as useEvmDisconnect,
  useNetwork as useEvmNetwork,
} from 'wagmi';

import { getSolanaChainName, getSolanaClusterName } from '../../consts/solanaChains';
import { logger } from '../../utils/logger';
import { sleep } from '../../utils/timeout';
import {
  getCaip2Id,
  getChainReference,
  getEthereumChainId,
  tryGetProtocolType,
} from '../chains/caip2';
import { ProtocolType } from '../chains/types';

export interface AccountInfo {
  protocol: ProtocolType;
  address?: Address;
  connectorName?: string;
  isReady: boolean;
}

export function useAccounts(): {
  accounts: Record<ProtocolType, AccountInfo>;
  readyAccounts: Array<AccountInfo>;
} {
  // Evm
  const { address, isConnected, connector } = useEvmAccount();
  const isEvmAccountReady = !!(address && isConnected && connector);
  const evmConnectorName = connector?.name;

  const evmAccountInfo: AccountInfo = useMemo(
    () => ({
      protocol: ProtocolType.Ethereum,
      address: address ? `${address}` : undefined, // massage wagmi addr type
      connectorName: evmConnectorName,
      isReady: isEvmAccountReady,
    }),
    [address, evmConnectorName, isEvmAccountReady],
  );

  useEffect(() => {
    if (isEvmAccountReady) logger.debug('Evm account ready:', address);
  }, [address, isEvmAccountReady]);

  // Solana
  const { publicKey, connected, wallet } = useSolanaWallet();
  const isSolAccountReady = !!(publicKey && wallet && connected);
  const solAddress = publicKey?.toBase58();
  const solConnectorName = wallet?.adapter?.name;

  const solAccountInfo: AccountInfo = useMemo(
    () => ({
      protocol: ProtocolType.Sealevel,
      address: solAddress,
      connectorName: solConnectorName,
      isReady: isSolAccountReady,
    }),
    [solAddress, solConnectorName, isSolAccountReady],
  );

  useEffect(() => {
    if (isSolAccountReady) logger.debug('Solana account ready:', solAddress);
  }, [solAddress, isSolAccountReady]);

  const readyAccounts = useMemo(
    () => [evmAccountInfo, solAccountInfo].filter((a) => a.isReady),
    [evmAccountInfo, solAccountInfo],
  );

  return useMemo(
    () => ({
      accounts: {
        [ProtocolType.Ethereum]: evmAccountInfo,
        [ProtocolType.Sealevel]: solAccountInfo,
      },
      readyAccounts,
    }),
    [evmAccountInfo, solAccountInfo, readyAccounts],
  );
}

export function useAccountForChain(caip2Id: Caip2Id): AccountInfo | undefined {
  const { accounts } = useAccounts();
  const protocol = tryGetProtocolType(caip2Id);
  if (!protocol) return undefined;
  return accounts[protocol];
}

export function useConnectFns(): Record<ProtocolType, () => void> {
  // Evm
  const { openConnectModal: openEvmModal } = useEvmodal();
  const onConnectEthereum = useCallback(() => openEvmModal?.(), [openEvmModal]);

  // Solana
  const { setVisible: setSolanaModalVisible } = useSolanaModal();
  const onConnectSolana = useCallback(() => setSolanaModalVisible(true), [setSolanaModalVisible]);

  return useMemo(
    () => ({
      [ProtocolType.Ethereum]: onConnectEthereum,
      [ProtocolType.Sealevel]: onConnectSolana,
    }),
    [onConnectEthereum, onConnectSolana],
  );
}

export function useDisconnectFns(): Record<ProtocolType, () => Promise<void>> {
  // Evm
  const { disconnectAsync: disconnectEvm } = useEvmDisconnect();

  // Solana
  const { disconnect: disconnectSol } = useSolanaWallet();

  const onClickDisconnect =
    (env: ProtocolType, disconnectFn?: () => Promise<void> | void) => async () => {
      try {
        if (!disconnectFn) throw new Error('Disconnect function is null');
        await disconnectFn();
      } catch (error) {
        logger.error(`Error disconnecting from ${env} wallet`, error);
        toast.error('Could not disconnect wallet');
      }
    };

  return useMemo(
    () => ({
      [ProtocolType.Ethereum]: onClickDisconnect(ProtocolType.Ethereum, disconnectEvm),
      [ProtocolType.Sealevel]: onClickDisconnect(ProtocolType.Sealevel, disconnectSol),
    }),
    [disconnectEvm, disconnectSol],
  );
}

export interface ActiveChainInfo {
  chainDisplayName?: string;
  caip2Id?: Caip2Id;
}

export function useActiveChains(): {
  chains: Record<ProtocolType, ActiveChainInfo>;
  readyChains: Array<ActiveChainInfo>;
} {
  // Evm
  const { chain } = useEvmNetwork();
  const evmChain: ActiveChainInfo = useMemo(
    () => ({
      chainDisplayName: chain?.name,
      caip2Id: chain ? getCaip2Id(ProtocolType.Ethereum, chain.id) : undefined,
    }),
    [chain],
  );

  // Solana
  const { connection } = useConnection();
  const { name: solName, displayName: solDisplayName } = getSolanaChainName(
    connection?.rpcEndpoint,
  );
  const solChain: ActiveChainInfo = useMemo(
    () => ({
      chainDisplayName: solDisplayName,
      caip2Id: solName ? getCaip2Id(ProtocolType.Sealevel, solName) : undefined,
    }),
    [solDisplayName, solName],
  );

  const readyChains = useMemo(
    () => [evmChain, solChain].filter((c) => !!c.chainDisplayName),
    [evmChain, solChain],
  );

  return useMemo(
    () => ({
      chains: {
        [ProtocolType.Ethereum]: evmChain,
        [ProtocolType.Sealevel]: solChain,
      },
      readyChains,
    }),
    [evmChain, solChain, readyChains],
  );
}

export type SendTransactionFn<TxResp = any> = (params: {
  tx: any;
  caip2Id: Caip2Id;
  activeCap2Id?: Caip2Id;
}) => Promise<{ hash: string; confirm: () => Promise<TxResp> }>;

export type SwitchNetworkFn = (caip2Id: Caip2Id) => Promise<void>;

export function useTransactionFns(): Record<
  ProtocolType,
  {
    sendTransaction: SendTransactionFn;
    switchNetwork?: SwitchNetworkFn;
  }
> {
  // Evm
  const onSwitchEvmNetwork = useCallback(async (caip2Id: Caip2Id) => {
    const chainId = getEthereumChainId(caip2Id);
    await switchEvmNetwork({ chainId });
    // Some wallets seem to require a brief pause after switch
    await sleep(1500);
  }, []);
  // Note, this doesn't use wagmi's prepare + send pattern because we're potentially sending two transactions
  // The prepare hooks are recommended to use pre-click downtime to run async calls, but since the flow
  // may require two serial txs, the prepare hooks aren't useful and complicate hook architecture considerably.
  // See https://github.com/hyperlane-xyz/hyperlane-warp-ui-template/issues/19
  // See https://github.com/wagmi-dev/wagmi/discussions/1564
  const onSendEvmTx = useCallback(
    async ({
      tx,
      caip2Id,
      activeCap2Id,
    }: {
      tx: any;
      caip2Id: Caip2Id;
      activeCap2Id?: Caip2Id;
    }) => {
      if (activeCap2Id && activeCap2Id !== caip2Id) await onSwitchEvmNetwork(caip2Id);
      const chainId = getEthereumChainId(caip2Id);
      const result = await sendEvmTransaction({
        chainId,
        request: tx as providers.TransactionRequest,
        mode: 'recklesslyUnprepared',
      });
      const { hash, wait } = result;
      return { hash, confirm: () => wait(1) };
    },
    [onSwitchEvmNetwork],
  );

  // Solana
  const { sendTransaction: sendSolTransaction } = useSolanaWallet();

  const onSwitchSolNetwork = useCallback(async (caip2Id: Caip2Id) => {
    toast.error(`Solana wallet must be connected to origin chain ${caip2Id}}`);
    // TODO re-enable when devnet->devnet transfers are no longer needed
    // throw new Error(`Auto network switching not supported for Solana`);
  }, []);

  const onSendSolTx = useCallback(
    async ({
      tx,
      caip2Id,
      activeCap2Id,
    }: {
      tx: any;
      caip2Id: Caip2Id;
      activeCap2Id?: Caip2Id;
    }) => {
      if (activeCap2Id && activeCap2Id !== caip2Id) await onSwitchSolNetwork(caip2Id);
      const reference = getChainReference(caip2Id);
      const cluster = getSolanaClusterName(reference);
      const connection = new SolConnection(clusterApiUrl(cluster), 'confirmed');
      const {
        context: { slot: minContextSlot },
        value: { blockhash, lastValidBlockHeight },
      } = await connection.getLatestBlockhashAndContext();

      const signature = await sendSolTransaction(tx, connection, { minContextSlot });

      const confirm = () =>
        connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature });
      return { hash: signature, confirm };
    },
    [onSwitchSolNetwork, sendSolTransaction],
  );

  return useMemo(
    () => ({
      [ProtocolType.Ethereum]: { sendTransaction: onSendEvmTx, switchNetwork: onSwitchEvmNetwork },
      [ProtocolType.Sealevel]: { sendTransaction: onSendSolTx, switchNetwork: onSwitchSolNetwork },
    }),
    [onSendEvmTx, onSendSolTx, onSwitchEvmNetwork, onSwitchSolNetwork],
  );
}
