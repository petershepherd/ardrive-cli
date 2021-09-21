import { CommunityOracle } from './community/community_oracle';
import { GQLTagInterface, winstonToAr } from 'ardrive-core-js';
import * as fs from 'fs';
import Transaction from 'arweave/node/lib/transaction';
import { ArFSDAOType, ArFSDAOAnonymous, ArFSPublicDrive, ArFSDAO } from './arfsdao';
import { TransactionID, ArweaveAddress, Winston, DriveID, FolderID, Bytes } from './types';
import { WalletDAO, Wallet } from './wallet_new';

export type ArFSEntityDataType = 'drive' | 'folder' | 'file';

export interface ArFSEntityData {
	type: ArFSEntityDataType;
	metadataTxId: TransactionID; // TODO: make a type that checks lengths
	key?: string;
}

// TODO: Is this really in the ArFS domain?
export interface ArFSTipData {
	txId: TransactionID; // TODO: make a type that checks lengths
	recipient: ArweaveAddress;
	winston: Winston; // TODO: make a type that checks validity
}

export type ArFSFees = { [key: string]: number };

export interface ArFSResult {
	created: ArFSEntityData[];
	tips: ArFSTipData[];
	fees: ArFSFees;
}

export abstract class ArDriveType {
	protected abstract readonly arFsDao: ArFSDAOType;
}

export class ArDriveAnonymous extends ArDriveType {
	constructor(protected readonly arFsDao: ArFSDAOAnonymous) {
		super();
	}

	async getPublicDrive(driveId: DriveID): Promise<ArFSPublicDrive> {
		const driveEntity = await this.arFsDao.getPublicDrive(driveId);
		return Promise.resolve(driveEntity);
	}
}

// TODO: ArDrive should accept App-Name and App-Version tags from constructor?
const commTipMetaTags: GQLTagInterface[] = [
	{ name: 'App-Name', value: 'ArDrive-CLI' },
	{ name: 'App-Version', value: '2.0' },
	{ name: 'Tip-Type', value: 'data upload' }
];

export class ArDrive extends ArDriveAnonymous {
	constructor(
		private readonly wallet: Wallet,
		private readonly walletDao: WalletDAO,
		protected readonly arFsDao: ArFSDAO,
		private readonly communityOracle: CommunityOracle
	) {
		super(arFsDao);
	}

	// TODO: FS shouldn't be reading the files more than once and doesn't belong in this class
	getFileSize(filePath: string): Bytes {
		return fs.statSync(filePath).size;
	}

	async prepareCommunityTipTrx(communityWinstonTip: Winston): Promise<Transaction> {
		const tokenHolder: ArweaveAddress = await this.communityOracle.selectTokenHolder();

		const communityTipTransaction = await this.walletDao.prepareARToAddressTransaction(
			winstonToAr(+communityWinstonTip),
			this.wallet,
			tokenHolder,
			commTipMetaTags
		);

		return communityTipTransaction;
	}

	async uploadPublicFile(
		parentFolderId: FolderID,
		filePath: string,
		destinationFileName?: string
	): Promise<ArFSResult> {
		// Retrieve drive ID from folder ID and ensure that it is indeed public
		const driveId = await this.arFsDao.getDriveIdForFolderId(parentFolderId);
		const drive = await this.arFsDao.getPublicDrive(driveId);
		if (!drive) {
			throw new Error(`Public drive with Drive ID ${driveId} not found!`);
		}

		const { dataTrx, metaDataTrx, fileId } = await this.arFsDao.preparePublicFileTransactions(
			parentFolderId,
			filePath,
			driveId,
			destinationFileName
		);

		const communityWinstonTip = await this.communityOracle.getCommunityWinstonTip(dataTrx.reward);
		const commTipTrx = await this.prepareCommunityTipTrx(communityWinstonTip);

		const totalWinstonPrice = (+dataTrx.reward + +commTipTrx.reward + +metaDataTrx.reward).toString();

		// TODO: Add interactive confirmation of AR price estimation

		if (!this.walletDao.walletHasBalance(this.wallet, totalWinstonPrice)) {
			throw new Error('Not enough AR for file upload..');
		}

		// TODO: Upload these as a bundle!
		await Promise.all([
			// Upload data transaction
			this.arFsDao.uploadByChunk(dataTrx),
			// Upload metadata transaction
			this.arFsDao.uploadByChunk(metaDataTrx),
			// Upload community tip transaction
			this.walletDao.submitTransaction(commTipTrx)
		]);

		return Promise.resolve({
			created: [
				{
					type: 'file',
					metadataTxId: metaDataTrx.id,
					dataTxId: dataTrx.id,
					entityId: fileId
				}
			],
			tips: [
				{
					txId: commTipTrx.id,
					recipient: commTipTrx.target,
					winston: commTipTrx.quantity
				}
			],
			fees: {
				[metaDataTrx.id]: +metaDataTrx.reward,
				[dataTrx.id]: +dataTrx.reward
			}
		});
	}

	async uploadPrivateFile(
		parentFolderId: FolderID,
		filePath: string,
		password: string,
		destinationFileName?: string
	): Promise<ArFSResult> {
		// Retrieve drive ID from folder ID and ensure that it is indeed a private drive
		const driveId = await this.arFsDao.getDriveIdForFolderId(parentFolderId);
		const drive = await this.arFsDao.getPrivateDrive(driveId, password);
		if (!drive) {
			throw new Error(`Private drive with Drive ID ${driveId} not found!`);
		}

		const { dataTrx, metaDataTrx, fileId } = await this.arFsDao.preparePrivateFileTransactions(
			parentFolderId,
			filePath,
			driveId,
			password,
			destinationFileName
		);

		const communityWinstonTip = await this.communityOracle.getCommunityWinstonTip(dataTrx.reward);
		const commTipTrx = await this.prepareCommunityTipTrx(communityWinstonTip);

		const totalWinstonPrice = (+dataTrx.reward + +commTipTrx.reward + +metaDataTrx.reward).toString();

		// TODO: Add interactive confirmation of AR price estimation

		if (!this.walletDao.walletHasBalance(this.wallet, totalWinstonPrice)) {
			throw new Error('Not enough AR for file upload..');
		}

		// TODO: Upload these as a bundle!
		await Promise.all([
			// Upload data transaction
			this.arFsDao.uploadByChunk(dataTrx),
			// Upload metadata transaction
			this.arFsDao.uploadByChunk(metaDataTrx),
			// Upload community tip transaction
			this.walletDao.submitTransaction(commTipTrx)
		]);

		return Promise.resolve({
			created: [
				{
					type: 'file',
					metadataTxId: metaDataTrx.id,
					dataTxId: dataTrx.id,
					entityId: fileId,
					// TODO: Implement returning the file key
					key: ''
				}
			],
			tips: [
				{
					txId: commTipTrx.id,
					recipient: commTipTrx.target,
					winston: commTipTrx.quantity
				}
			],
			fees: {
				[metaDataTrx.id]: +metaDataTrx.reward,
				[dataTrx.id]: +dataTrx.reward,
				[commTipTrx.id]: +commTipTrx.reward
			}
		});
	}

	async createPublicFolder(folderName: string, driveId: string, parentFolderId?: FolderID): Promise<ArFSResult> {
		// TODO: Fetch drive ID for parent folder ID

		// Generate a new drive ID
		const { folderTrx, folderId } = await this.arFsDao.createPublicFolder(folderName, driveId, parentFolderId);

		// IN THE FUTURE WE'LL SEND A COMMUNITY TIP HERE
		return Promise.resolve({
			created: [
				{
					type: 'folder',
					metadataTxId: folderTrx.id,
					entityId: folderId
				}
			],
			tips: [],
			fees: {
				[folderTrx.id]: +folderTrx.reward
			}
		});
	}

	async createPublicDrive(driveName: string): Promise<ArFSResult> {
		// Generate a new drive ID
		const { driveTrx, rootFolderTrx, driveId, rootFolderId } = await this.arFsDao.createPublicDrive(driveName);

		// IN THE FUTURE WE'LL SEND A COMMUNITY TIP HERE
		return Promise.resolve({
			created: [
				{
					type: 'drive',
					metadataTxId: driveTrx.id,
					entityId: driveId
				},
				{
					type: 'folder',
					metadataTxId: rootFolderTrx.id,
					entityId: rootFolderId
				}
			],
			tips: [],
			fees: {
				[driveTrx.id]: +driveTrx.reward,
				[rootFolderTrx.id]: +rootFolderTrx.reward
			}
		});
	}

	async createPrivateDrive(driveName: string, password: string): Promise<ArFSResult> {
		// Generate a new drive ID
		const { driveTrx, rootFolderTrx, driveId, rootFolderId, driveKey } = await this.arFsDao.createPrivateDrive(
			driveName,
			password
		);

		// IN THE FUTURE WE'LL SEND A COMMUNITY TIP HERE
		return Promise.resolve({
			created: [
				{
					type: 'drive',
					metadataTxId: driveTrx.id,
					entityId: driveId,
					key: driveKey.toString('hex')
				},
				{
					type: 'folder',
					metadataTxId: rootFolderTrx.id,
					entityId: rootFolderId,
					key: driveKey.toString('hex')
				}
			],
			tips: [],
			fees: {
				[driveTrx.id]: +driveTrx.reward,
				[rootFolderTrx.id]: +rootFolderTrx.reward
			}
		});
	}

	async getPrivateDrive(driveId: DriveID, drivePassword: string): Promise<ArFSPublicDrive> {
		const driveEntity = await this.arFsDao.getPrivateDrive(driveId, drivePassword);
		return Promise.resolve(driveEntity);
	}
}
