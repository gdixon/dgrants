// --- Types ---
import {
  GrantRound,
  Contribution,
  GrantRoundCLR,
  GrantsRoundDetails,
  GrantRoundMetadataResolution,
  GrantPrediction,
} from '@dgrants/types';
import { LocalStorageData } from 'src/types';
// --- Methods and Data ---
import useWalletStore from 'src/store/wallet';
import { BigNumber, Contract, Event } from 'ethers';
import { formatUnits } from 'ethers/lib/utils';
import { formatNumber, callMulticallContract } from '../utils';
import { syncStorage } from 'src/utils/data/utils';
import { CLR, linear, InitArgs } from '@dgrants/dcurve';
import { filterContributionsByGrantId, filterContributionsByGrantRound } from './contributions';
// --- Constants ---
import { START_BLOCK, SUPPORTED_TOKENS_MAPPING, GRANT_REGISTRY_ADDRESS } from 'src/utils/chains';
import {
  GRANT_ROUND_ABI,
  ERC20_ABI,
  allGrantRoundsKey,
  grantRoundKeyPrefix,
  grantRoundsCLRDataKeyPrefix,
} from 'src/utils/constants';

/**
 * @notice Get/Refresh all GrantRound addresses
 *
 * @param {number} blockNumber The currenct block number
 * @param {boolean} forceRefresh Force the cache to refresh
 */
export async function getAllGrantRounds(blockNumber: number, forceRefresh = false) {
  return await syncStorage(
    allGrantRoundsKey,
    {
      blockNumber: blockNumber,
    },
    async (localStorageData?: LocalStorageData | undefined, save?: () => void) => {
      const { grantRoundManager } = useWalletStore();
      // use the ls_blockNumber to decide if we need to update the roundAddresses
      const ls_blockNumber = localStorageData?.blockNumber || START_BLOCK;
      // only update roundAddress if new ones are added...
      const ls_roundAddresses = localStorageData?.data?.roundAddresses || [];
      // every block
      if (forceRefresh || !localStorageData || (localStorageData && ls_blockNumber < blockNumber)) {
        // get the most recent block we collected
        const fromBlock = ls_blockNumber + 1 || START_BLOCK;
        const newRounds =
          (
            await grantRoundManager.value?.queryFilter(
              grantRoundManager.value?.filters.GrantRoundCreated(null),
              fromBlock,
              blockNumber
            )
          ).map((e: Event) => e.args?.grantRound) || [];

        // add new rounds
        ls_roundAddresses.push(...newRounds);
      }

      // hydrate/format roundAddresses for use
      const roundAddresses = {
        roundAddresses: ls_roundAddresses,
      };

      // conditionally save the new roundAddresses
      if (ls_roundAddresses.length && save) {
        save();
      }

      return roundAddresses;
    }
  );
}

/**
 * @notice Get/Refresh the details of a single GrantRound - we need to run this frequently to get any changes in balance
 *
 * @param {number} blockNumber The currenct block number
 * @param {string} grantRoundAddress The grantRoundAddress to get the details for
 * @param {boolean} forceRefresh Force the cache to refresh
 */
export async function getGrantRound(blockNumber: number, grantRoundAddress: string, forceRefresh?: boolean) {
  return await syncStorage(
    grantRoundKeyPrefix + grantRoundAddress,
    {
      blockNumber: blockNumber,
    },
    async (localStorageData?: LocalStorageData | undefined, save?: () => void) => {
      const { provider } = useWalletStore();
      // use the ls_blockNumber to decide if we need to update the rounds data
      const ls_blockNumber = localStorageData?.blockNumber || 0;
      // current state
      let {
        startTime,
        endTime,
        metadataAdmin,
        payoutAdmin,
        registryAddress,
        metaPtr,
        hasPaidOut,
        donationToken,
        matchingToken,
        funds,
        donationTokenAddress,
      } = localStorageData?.data?.grantRound || {};
      // open the rounds contract
      const roundContract = new Contract(grantRoundAddress, GRANT_ROUND_ABI, provider.value);
      // collect the donationToken & matchingToken before promise.all'ing everything
      const matchingTokenAddress = matchingToken?.address || (await roundContract.matchingToken());
      // use matchingTokenContract to get balance
      const matchingTokenContract = new Contract(matchingTokenAddress, ERC20_ABI, provider.value);
      // full update of stored data
      if (forceRefresh || !localStorageData) {
        // Define calls to be read using multicall
        [
          donationTokenAddress,
          startTime,
          endTime,
          metadataAdmin,
          payoutAdmin,
          registryAddress,
          metaPtr,
          hasPaidOut,
          funds,
        ] = await callMulticallContract([
          // pull the grantRound data from its contract
          {
            target: grantRoundAddress,
            contract: roundContract,
            fns: [
              'donationToken',
              'startTime',
              'endTime',
              'metadataAdmin',
              'payoutAdmin',
              'registry',
              'metaPtr',
              'hasPaidOut',
            ],
          },
          // get the balance from the matchinTokenContract
          {
            target: matchingTokenAddress,
            contract: matchingTokenContract,
            fns: [
              {
                fn: 'balanceOf',
                args: [grantRoundAddress],
              },
            ],
          },
        ]);
        // get the donation/matching token
        matchingToken = SUPPORTED_TOKENS_MAPPING[matchingTokenAddress];
        donationToken = SUPPORTED_TOKENS_MAPPING[donationTokenAddress];
        // record the funds as a human readable number
        funds = parseFloat(formatUnits(BigNumber.from(funds), SUPPORTED_TOKENS_MAPPING[matchingTokenAddress].decimals));
      } else if (localStorageData && ls_blockNumber < blockNumber) {
        // get the most recent block we collected
        const fromBlock = ls_blockNumber + 1 || 0;
        // get updated metadata
        const [updatedMetadata, newTransfers] = await Promise.all([
          roundContract.queryFilter(roundContract.filters.MetadataUpdated(), fromBlock, blockNumber),
          matchingTokenContract.queryFilter(
            matchingTokenContract.filters.Transfer(null, grantRoundAddress),
            fromBlock,
            blockNumber
          ),
        ]);
        // get any new funding transfers
        updatedMetadata.forEach((metaUpdate: Event) => {
          metaPtr = metaUpdate?.args?.newMetaPtr;
        });
        newTransfers.forEach((transfer: Event) => {
          funds = BigNumber.from(funds)
            .add(
              parseFloat(formatUnits(transfer?.args?.amount, SUPPORTED_TOKENS_MAPPING[matchingTokenAddress].decimals))
            )
            .toString();
        });
      }
      // build status against now (unix)
      const now = Date.now() / 1000;
      // place the GrantRound details into a GrantRound object
      const grantRound = {
        grantRound: {
          startTime,
          endTime,
          metadataAdmin,
          payoutAdmin,
          registryAddress,
          metaPtr,
          hasPaidOut,
          donationToken: donationToken,
          matchingToken: matchingToken,
          address: grantRoundAddress,
          funds: funds,
          status:
            now >= BigNumber.from(startTime).toNumber() && now < BigNumber.from(endTime).toNumber()
              ? 'Active'
              : now < BigNumber.from(startTime).toNumber()
              ? 'Upcoming'
              : 'Completed',
          registry: GRANT_REGISTRY_ADDRESS,
          error: undefined,
        } as GrantRound,
      };

      // mark this for renewal
      if (grantRound.grantRound.startTime && save) {
        save();
      }

      // return the GrantRound data
      return grantRound;
    }
  );
}

/**
 * @notice Get/Refresh all GrantRound Grant data
 *
 * @param {number} blockNumber The latest blockNumber
 * @param {Object} contributions A dict of all contributions (contribution.txHash->contribution)
 * @param {Object} trustBonus A dict of all trustBonus scores (contribution.payee->trustBonusScore)
 * @param {String} grantRoundAddress The grantRound address we want details for
 * @param {Array} grantIds An array of grantIds
 * @param {TokenInfo} matchingToken The matchingToken used by the grantRound
 * @param {boolean} forceRefresh Force the cache to refresh
 */
export async function getGrantRoundGrantData(
  blockNumber: number,
  contributions: Contribution[],
  trustBonus: { [address: string]: number },
  grantRound: GrantRound,
  grantIds: string[],
  forceRefresh = false
) {
  const clr = new CLR({
    calcAlgo: linear,
    includePayouts: false,
  } as InitArgs);

  return await syncStorage(
    grantRoundsCLRDataKeyPrefix + grantRound.address,
    {
      blockNumber: blockNumber,
    },
    async (localStorageData?: LocalStorageData | undefined, save?: () => void) => {
      const roundGrantData = localStorageData?.data?.grantRoundCLR || {};
      // unpack current ls state
      let ls_grantDonations: Contribution[] = roundGrantData?.contributions || [];
      let ls_grantPredictions = roundGrantData?.predictions || {};

      // every block
      if (
        forceRefresh ||
        !localStorageData ||
        (localStorageData && (localStorageData.blockNumber || START_BLOCK) < blockNumber)
      ) {
        // total the number of contributions being considered in the current prediction
        const oldDonationCount = ls_grantDonations.length;
        // fetch contributions
        ls_grantDonations = Object.values(contributions).filter((contribution: Contribution) => {
          // check that the contribution is valid
          const inRound = contribution.inRounds?.includes(grantRound.address);

          // only include transactions from this grantRound which havent been ignored
          return inRound;
        });

        // re-run predict if there are any new contributions/grants
        if (ls_grantDonations.length > oldDonationCount || grantIds.length > Object.keys(ls_grantPredictions).length) {
          // scores are to be presented in an array
          const trustBonusScores = Object.keys(trustBonus).map((address) => {
            return {
              address: address,
              score: trustBonus[address],
            };
          });
          // get all predictions for each grant in this round
          ls_grantPredictions = (
            await Promise.all(
              grantIds.map((grantId: string) =>
                clr.predict({
                  grantId: grantId,
                  predictionPoints: [0, 1, 10, 100, 1000, 10000],
                  trustBonusScores: trustBonusScores,
                  grantRoundContributions: {
                    grantRound: grantRound.address,
                    totalPot: BigNumber.from(grantRound.funds).toNumber(),
                    matchingTokenDecimals: grantRound.matchingToken.decimals,
                    contributions: ls_grantDonations,
                  },
                })
              )
            )
          ).reduce((predictions, prediction) => {
            // record as a dict (grantId -> GrantPrediction)
            predictions[prediction.grantId] = prediction;
            return predictions;
          }, {} as Record<string, GrantPrediction>);
        }
      }

      const grantRoundCLR = {
        grantRoundCLR: {
          grantRound: grantRound.address,
          totalPot: BigNumber.from(grantRound.funds).toNumber(),
          matchingTokenDecimals: grantRound.matchingToken.decimals,
          contributions: ls_grantDonations,
          predictions: ls_grantPredictions,
        } as GrantRoundCLR,
      };

      if (ls_grantDonations.length && save) {
        save();
      }

      return grantRoundCLR;
    }
  );
}

/**
 * @notice returns the predictions for this grant in the given round
 */
export function getPredictionsForGrantInRound(grantId: string, roundData: GrantRoundCLR) {
  return roundData.predictions && roundData.predictions[Number(grantId)];
}

/**
 * @notice Returns the details for all grantRounds this grant is a member of
 */
export function getGrantsGrantRoundDetails(
  grantId: string,
  rounds: GrantRound[],
  roundsMetadata: Record<string, GrantRoundMetadataResolution>,
  grantRoundsCLRData: Record<string, GrantRoundCLR>,
  contributions: Contribution[]
) {
  // get all contributions for this grant
  const grant_contributions = filterContributionsByGrantId(grantId, contributions);

  return rounds.map((round) => {
    // get the predictions for this grant in this round
    const predictions = getPredictionsForGrantInRound(grantId, grantRoundsCLRData[round.address]);
    // filter only contributions which should be considered for this round (should we also/only check metadata here?)
    const roundContributions = filterContributionsByGrantRound(round, grant_contributions);
    // sum the contributions which were made against this round
    const roundsContributionTotal = roundContributions
      .reduce((carr, contrib) => (contrib ? contrib.amount + carr : carr), 0)
      .toString();

    return {
      grantId: grantId,
      address: round.address,
      metaPtr: round.metaPtr,
      name: roundsMetadata[round.metaPtr].name || '',
      matchingToken: round.matchingToken,
      donationToken: round.donationToken,
      contributions: roundContributions,
      balance: formatNumber(roundsContributionTotal, 2),
      matching: predictions && formatNumber(predictions.predictions[0].predictedGrantMatch, 2),
      prediction1: predictions && formatNumber(predictions.predictions[1].predictionDiff, 2),
      prediction10: predictions && formatNumber(predictions.predictions[2].predictionDiff, 2),
      prediction100: predictions && formatNumber(predictions.predictions[3].predictionDiff, 2),
    } as GrantsRoundDetails;
  });
}
