import { weightedRandom } from 'ardrive-core-js';
import { ContractOracle } from './contract_oracle';
import { CommunityOracle } from './community_oracle';
import { VertoContractOracle } from './verto_contract_oracle';
import { ArweaveAddress } from '../wallet_new';

/**
 * Minimum ArDrive community tip from the Community Improvement Proposal Doc:
 * https://arweave.net/Yop13NrLwqlm36P_FDCdMaTBwSlj0sdNGAC4FqfRUgo
 */
export const minArDriveCommunityARTip = 0.000_010_000_000;

/**
 * Oracle class responsible for determining the community tip
 * and selecting the PST token holder for tip distribution
 * */
export class ArDriveCommunityOracle implements CommunityOracle {
	constructor(private readonly contractOracle: ContractOracle = new VertoContractOracle()) {}

	/** Given an AR data cost, returns a calculated ArDrive community tip amount in AR */
	async getCommunityARTip(arCost: number): Promise<number> {
		const communityTipValue = await this.contractOracle.getTipSettingFromContractSettings();
		const arDriveCommunityTip = arCost * (communityTipValue / 100);
		return Math.max(arDriveCommunityTip, minArDriveCommunityARTip);
	}

	/** Gets a random ArDrive token holder based off their weight (amount of tokens they hold)  */
	async selectTokenHolder(): Promise<ArweaveAddress> {
		// Read the ArDrive Smart Contract to get the latest state
		const contract = await this.contractOracle.getCommunityContract();

		const balances = contract.balances;
		const vault = contract.vault;

		// Get the total number of token holders
		let total = 0;
		for (const addr of Object.keys(balances)) {
			total += balances[addr];
		}

		// Check for how many tokens the user has staked/vaulted
		for (const addr of Object.keys(vault)) {
			if (!vault[addr].length) continue;

			const vaultBalance = vault[addr]
				.map((a: { balance: number; start: number; end: number }) => a.balance)
				.reduce((a: number, b: number) => a + b, 0);

			total += vaultBalance;

			if (addr in balances) {
				balances[addr] += vaultBalance;
			} else {
				balances[addr] = vaultBalance;
			}
		}

		// Create a weighted list of token holders
		const weighted: { [addr: string]: number } = {};
		for (const addr of Object.keys(balances)) {
			weighted[addr] = balances[addr] / total;
		}
		// Get a random holder based off of the weighted list of holders
		const randomHolder = weightedRandom(weighted);

		if (randomHolder === undefined) {
			throw new Error('Token holder target could not be determined for community tip distribution..');
		}

		return randomHolder;
	}
}

// Self-test with: yarn ts-node src/community/ardrive_community_oracle.ts
(async () => console.log(await new ArDriveCommunityOracle().getCommunityARTip(1)))();
(async () => console.log(await new ArDriveCommunityOracle().selectTokenHolder()))();
