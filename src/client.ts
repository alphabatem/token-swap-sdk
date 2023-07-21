import {BN, web3} from "@project-serum/anchor";
import {
	createAssociatedTokenAccountInstruction,
	createCloseAccountInstruction,
	createHarvestWithheldTokensToMintInstruction,
	createSyncNativeInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_2022_PROGRAM_ID
} from "@solana/spl-token";
import {PoolConfig, TokenInput, TokenSwapLayout, TokenSwapPool} from "./layouts";
import {SWAP_PROGRAM_ID, WSOL} from "./constants";
import {CreateTokenPool} from "./create_token_pool";
import Instructions from "./instructions";

export default class Client {

	connection;

	poolTokenProgramId = TOKEN_2022_PROGRAM_ID //The program ID of the token program for the pool tokens

	constructor(connection: web3.Connection) {
		this.connection = connection
	}


	async getPools() {
		const resp = await this.connection.getProgramAccounts(SWAP_PROGRAM_ID)
		return resp.map((m) => {
			return {pubkey: m.pubkey, account: TokenSwapLayout.decode(m.account.data)}
		})
	}


	async getSwapPools(tokenA: web3.PublicKey, tokenB: web3.PublicKey) {
		const resp = await this.connection.getProgramAccounts(SWAP_PROGRAM_ID, {
			commitment: 'confirmed',
			filters: [
				{
					memcmp: {
						offset: 1 + 1 + 1 + 32 + 32 + 32 + 32,
						bytes: tokenA.toString(),
					},
				},
				{
					memcmp: {
						offset: 1 + 1 + 1 + 32 + 32 + 32 + 32 + 32,
						bytes: tokenB.toString(),
					},
				},
			],
		})
		const respInverse = await this.connection.getProgramAccounts(SWAP_PROGRAM_ID, {
			commitment: 'confirmed',
			filters: [
				{
					memcmp: {
						offset: 1 + 1 + 1 + 32 + 32 + 32 + 32,
						bytes: tokenB.toString(),
					},
				},
				{
					memcmp: {
						offset: 1 + 1 + 1 + 32 + 32 + 32 + 32 + 32,
						bytes: tokenA.toString(),
					},
				},
			],
		})
		return resp.concat(respInverse).map((m) => {
			return {pubkey: m.pubkey, account: TokenSwapLayout.decode(m.account.data)}
		})
	}


	async getSwapPoolsSingle(tokenA: web3.PublicKey) {
		const resp = await this.connection.getProgramAccounts(SWAP_PROGRAM_ID, {
			commitment: 'confirmed',
			filters: [
				{
					memcmp: {
						offset: 1 + 1 + 1 + 32 + 32 + 32 + 32,
						bytes: tokenA.toString(),
					},
				},
			],
		})
		const respInverse = await this.connection.getProgramAccounts(SWAP_PROGRAM_ID, {
			commitment: 'confirmed',
			filters: [
				{
					memcmp: {
						offset: 1 + 1 + 1 + 32 + 32 + 32 + 32 + 32,
						bytes: tokenA.toString(),
					},
				},
			],
		})
		return resp.concat(respInverse).map((m) => {
			return {pubkey: m.pubkey, account: TokenSwapLayout.decode(m.account.data)}
		})
	}


	async getPool(pool: web3.PublicKey) {
		const resp = await this.connection.getAccountInfo(pool, "confirmed")
		return {pubkey: pool, owner: resp?.owner, account: TokenSwapLayout.decode(resp!.data)}
	}

	async getPoolDetail(poolPK: web3.PublicKey, pool: TokenSwapPool, walletPk: web3.PublicKey) {
		const [authority] = web3.PublicKey.findProgramAddressSync([poolPK.toBuffer()], SWAP_PROGRAM_ID);
		const resp = await this.connection.getMultipleParsedAccounts([
			pool.tokenAccountA,
			pool.tokenAccountB,
			getAssociatedTokenAddressSync(pool.tokenPool, poolPK, false, TOKEN_2022_PROGRAM_ID),
			getAssociatedTokenAddressSync(pool.tokenPool, walletPk, false, TOKEN_2022_PROGRAM_ID),
			pool.mintA,
			pool.mintB,
			pool.tokenPool,
		])
		console.log("LP Mint:", pool.tokenPool.toString())

		return {
			//@ts-ignore
			tokenAccountA: resp?.value[0]?.data?.parsed?.info,
			//@ts-ignore
			tokenAccountB: resp?.value[1]?.data?.parsed?.info,
			//@ts-ignore
			tokenPool: resp?.value[2]?.data?.parsed?.info,
			//@ts-ignore
			userLP: resp?.value[3]?.data?.parsed?.info,
			//@ts-ignore
			mintA: resp?.value[4]?.data?.parsed?.info,
			//@ts-ignore
			mintB: resp?.value[5]?.data?.parsed?.info,
			//@ts-ignore
			mintLp: resp?.value[6]?.data?.parsed?.info,
			poolAddress: poolPK,
		}
	}

	async createPoolTransactions(
		payer: web3.PublicKey,
		feeAccount: web3.PublicKey,
		tokenA: TokenInput,
		tokenB: TokenInput,
		config: PoolConfig,
	) {
		const cp = new CreateTokenPool(
			this.connection,
			payer,
			feeAccount,
			tokenA,
			tokenB,
			config
		)

		const initTxn = await cp.initializeTransaction()
		const createTxn = await cp.createTransaction()

		// return [
		// 	{
		// 		txn: initTxn.transaction,
		// 		signers: initTxn.signers
		// 	}, {
		// 		txn: createTxn.transaction,
		// 		signers: createTxn.signers
		// 	}
		// ]

		initTxn.transaction.add(...createTxn.transaction.instructions)
		initTxn.signers.push(...createTxn.signers)

		return [
			{
				pool: cp.tokenSwapAccount.publicKey,
				txn: initTxn.transaction,
				signers: initTxn.signers
			}
		]
	}

	async createSwapTransaction(payer: web3.PublicKey, pool: web3.PublicKey, srcMint: TokenInput, dstMint: TokenInput, route: TokenSwapPool, amountIn: number, minimumAmountOut: number) {
		const aToB = srcMint.mint.equals(route.mintA)

		console.log("createSwapTransaction", {
			amountIn,
			minimumAmountOut,
			srcMint: srcMint.mint.toString(),
			dstMint: dstMint.mint.toString(),
			routeSrc: route.mintA.toString(),
			routeDst: route.mintB.toString(),
			aToBo: aToB
		})
		const mintAInfo = await this.connection.getParsedAccountInfo(srcMint.mint)
		const mintBInfo = await this.connection.getParsedAccountInfo(dstMint.mint)

		const transaction = new web3.Transaction()

		const [authority] = web3.PublicKey.findProgramAddressSync([pool.toBuffer()], SWAP_PROGRAM_ID);

		const userSource = getAssociatedTokenAddressSync(srcMint.mint, payer, false, mintAInfo.value?.owner!)
		const userDestination = getAssociatedTokenAddressSync(dstMint.mint, payer, false, mintBInfo.value?.owner!)
		const userDestinationInfo = await this.connection.getParsedAccountInfo(userDestination)

		const poolSource = aToB ? route.tokenAccountA : route.tokenAccountB
		const poolDestination = aToB ? route.tokenAccountB : route.tokenAccountA


		if (srcMint.mint.equals(WSOL)) {
			//Do sync native checks
			const ixs = await this.getWrapSOLInstructions(payer, srcMint.amount);
			if (ixs.length > 0)
				transaction.add(...ixs)
		}

		if (!userDestinationInfo.value) {
			transaction.add(createAssociatedTokenAccountInstruction(payer, userDestination, payer, dstMint.mint, mintBInfo.value?.owner!))
		}

		transaction.add(Instructions.createSwapInstruction(
			pool,
			authority,
			payer,
			userSource,
			poolSource,
			poolDestination,
			userDestination,
			route.tokenPool,
			route.feeAccount,
			route.feeAccount, //hostFeeAccount,
			srcMint.mint,
			dstMint.mint,
			SWAP_PROGRAM_ID,
			mintAInfo.value?.owner!,
			mintBInfo.value?.owner!,
			TOKEN_2022_PROGRAM_ID,
			new BN(amountIn, 10),
			new BN(minimumAmountOut, 10),
		))

		if (dstMint.mint.equals(WSOL)) {
			//Do sync native checks
			transaction.add(this.getUnwrapSOLInstruction(payer))
		}


		if (this.hasTransferFeeConfig(mintAInfo))
			transaction.add(createHarvestWithheldTokensToMintInstruction(
				srcMint.mint,
				[
					userSource,
					poolSource
				]
			))

		if (this.hasTransferFeeConfig(mintBInfo))
			transaction.add(createHarvestWithheldTokensToMintInstruction(
				dstMint.mint,
				[
					userDestination,
					poolDestination
				]
			))

		return transaction
	}


	async createAddLiquidityTransaction(payer: web3.PublicKey, pool: web3.PublicKey, route: TokenSwapPool, srcMint: TokenInput, dstMint: TokenInput, poolTokenAmount: BN) {
		const mintAInfo = await this.connection.getParsedAccountInfo(route.mintA)
		const mintBInfo = await this.connection.getParsedAccountInfo(route.mintB)
		const [authority] = web3.PublicKey.findProgramAddressSync([pool.toBuffer()], SWAP_PROGRAM_ID);

		const userAccountA = getAssociatedTokenAddressSync(route.mintA, payer, false, mintAInfo.value?.owner!)
		const userAccountB = getAssociatedTokenAddressSync(route.mintB, payer, false, mintBInfo.value?.owner!)
		const userPoolTokenAccount = getAssociatedTokenAddressSync(route.tokenPool, payer, false, TOKEN_2022_PROGRAM_ID)

		const balanceInfo = await this.connection.getMultipleParsedAccounts([userPoolTokenAccount], {commitment: "confirmed"})
		const [userPoolTokenAccountInfo] = balanceInfo.value

		const transaction = new web3.Transaction()

		if (route.mintA.equals(WSOL)) {
			//Do sync native checks
			const ixs = await this.getWrapSOLInstructions(payer, srcMint.amount);
			if (ixs.length > 0)
				transaction.add(...ixs)
		}

		if (route.mintB.equals(WSOL)) {
			//Do sync native checks
			const ixs = await this.getWrapSOLInstructions(payer, dstMint.amount);
			if (ixs.length > 0)
				transaction.add(...ixs)
		}

		if (!userPoolTokenAccountInfo)
			transaction.add(createAssociatedTokenAccountInstruction(payer, userPoolTokenAccount, payer, route.tokenPool, TOKEN_2022_PROGRAM_ID))

		transaction.add(Instructions.depositAllTokenTypesInstruction(
			pool,
			authority,
			payer,
			userAccountA,
			userAccountB,
			route.tokenAccountA,
			route.tokenAccountB,
			route.tokenPool,
			userPoolTokenAccount,
			route.mintA,
			route.mintB,
			SWAP_PROGRAM_ID,
			mintAInfo.value?.owner!,
			mintBInfo.value?.owner!,
			TOKEN_2022_PROGRAM_ID,
			new BN(poolTokenAmount, 10),
			new BN(srcMint.amount, 10),
			new BN(dstMint.amount, 10),
		))

		if (route.mintB.equals(WSOL)) {
			//Do sync native checks
			transaction.add(await this.getUnwrapSOLInstruction(payer))
		}

		return transaction
	}

	async createAddSingleSideLiquidityTransaction(payer: web3.PublicKey, pool: web3.PublicKey, route: TokenSwapPool, srcMint: TokenInput, minPoolTokenAmount: BN) {
		const [authority] = web3.PublicKey.findProgramAddressSync([pool.toBuffer()], SWAP_PROGRAM_ID);

		const userAccount = getAssociatedTokenAddressSync(srcMint.mint, payer, false, srcMint.programID)
		const userPoolTokenAccount = getAssociatedTokenAddressSync(route.tokenPool, payer, false, TOKEN_2022_PROGRAM_ID)

		const balanceInfo = await this.connection.getMultipleParsedAccounts([userPoolTokenAccount], {commitment: "confirmed"})
		const [userPoolTokenAccountInfo] = balanceInfo.value

		const transaction = new web3.Transaction()

		if (srcMint.mint.equals(WSOL)) {
			//Do sync native checks
			const ixs = await this.getWrapSOLInstructions(payer, srcMint.amount);
			if (ixs.length > 0)
				transaction.add(...ixs)
		}

		if (!userPoolTokenAccountInfo)
			transaction.add(createAssociatedTokenAccountInstruction(payer, userPoolTokenAccount, payer, route.tokenPool, TOKEN_2022_PROGRAM_ID))

		transaction.add(Instructions.depositSingleTokenTypeExactAmountInInstruction(
			pool,
			authority,
			payer,
			userAccount,
			route.tokenAccountA,
			route.tokenAccountB,
			route.tokenPool,
			userPoolTokenAccount,
			srcMint.mint,
			SWAP_PROGRAM_ID,
			srcMint.programID,
			TOKEN_2022_PROGRAM_ID,
			new BN(srcMint.amount, 10),
			new BN(minPoolTokenAmount)
		))

		return transaction
	}

	async createRemoveLiquidityTransaction(payer: web3.PublicKey, pool: web3.PublicKey, route: TokenSwapPool, poolTokenAmount: number, minimumTokenA: number, minimumTokenB: number) {
		const mintAInfo = await this.connection.getParsedAccountInfo(route.mintA)
		const mintBInfo = await this.connection.getParsedAccountInfo(route.mintB)
		const [authority] = web3.PublicKey.findProgramAddressSync([pool.toBuffer()], SWAP_PROGRAM_ID);

		const userAccountA = getAssociatedTokenAddressSync(route.mintA, payer, false, mintAInfo.value?.owner!)
		const userAccountB = getAssociatedTokenAddressSync(route.mintB, payer, false, mintBInfo.value?.owner!)
		const userPoolTokenAccount = getAssociatedTokenAddressSync(route.tokenPool, payer, false, TOKEN_2022_PROGRAM_ID)

		const balanceInfo = await this.connection.getMultipleParsedAccounts([userAccountA, userAccountB, route.tokenAccountA, route.tokenAccountB, userPoolTokenAccount])

		const [uAInfo, uBInfo, tAInfo, tBInfo, spInfo] = balanceInfo.value

		console.log({
			//@ts-ignore
			userAccountAAmount: uAInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			userAccountBAmount: uBInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			tokenAccountAAmount: tAInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			tokenAccountBAmount: tBInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			sourcePoolAccountAmount: spInfo?.data.parsed.info.tokenAmount.amount,
		})

		const transaction = new web3.Transaction()
		// deposit_all_token_types  deposit_single_token_type_exact_amount_in

		//Create wSOL account
		if (route.mintA.equals(WSOL) || route.mintB.equals(WSOL)) {
			const ixs = await this.getWrapSOLInstructions(payer, 0);
			if (ixs.length > 0)
				transaction.add(...ixs)
		}

		if (!uAInfo?.data && !route.mintA.equals(WSOL)) {
			transaction.add(createAssociatedTokenAccountInstruction(payer, userAccountA, payer, route.mintA, mintAInfo.value?.owner!))
		}

		if (!uBInfo?.data && !route.mintB.equals(WSOL)) {
			transaction.add(createAssociatedTokenAccountInstruction(payer, userAccountB, payer, route.mintB, mintBInfo.value?.owner!))
		}


		transaction.add(Instructions.withdrawAllTokenTypesInstruction(
			pool,
			authority,
			payer,
			route.tokenPool,
			route.feeAccount,
			userPoolTokenAccount,
			route.tokenAccountA,
			route.tokenAccountB,
			userAccountA,
			userAccountB,
			route.mintA,
			route.mintB,
			SWAP_PROGRAM_ID,
			TOKEN_2022_PROGRAM_ID,
			mintAInfo.value?.owner!,
			mintBInfo.value?.owner!,
			poolTokenAmount,
			minimumTokenA,
			minimumTokenB,
		))

		//Unwrap sol
		if (route.mintA.equals(WSOL) || route.mintB.equals(WSOL))
			transaction.add(this.getUnwrapSOLInstruction(payer))

		return transaction
	}

	//TODO Test
	async createRemoveSingleSideLiquidityTransaction(payer: web3.PublicKey, pool: web3.PublicKey, route: TokenSwapPool, dstMint: TokenInput, poolTokenAmount: number) {
		const mintInfo = await this.connection.getParsedAccountInfo(dstMint.mint)
		const [authority] = web3.PublicKey.findProgramAddressSync([pool.toBuffer()], SWAP_PROGRAM_ID);

		const userAccount = getAssociatedTokenAddressSync(dstMint.mint, payer, false, mintInfo.value?.owner!)

		const userPoolTokenAccount = getAssociatedTokenAddressSync(route.tokenPool, payer, false, TOKEN_2022_PROGRAM_ID)

		const balanceInfo = await this.connection.getMultipleParsedAccounts([userAccount, route.tokenAccountA, route.tokenAccountB, userPoolTokenAccount])

		const [uAInfo, tAInfo, tBInfo, spInfo] = balanceInfo.value

		console.log({
			//@ts-ignore
			userAccountAAmount: uAInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			tokenAccountAAmount: tAInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			tokenAccountBAmount: tBInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			sourcePoolAccountAmount: spInfo?.data.parsed.info.tokenAmount.amount,
		})

		const transaction = new web3.Transaction()

		//Create wSOL account
		if (dstMint.mint.equals(WSOL)) {
			const ixs = await this.getWrapSOLInstructions(payer, 0);
			if (ixs.length > 0)
				transaction.add(...ixs)
		}

		if (!uAInfo?.data && !dstMint.mint.equals(WSOL)) {
			transaction.add(createAssociatedTokenAccountInstruction(payer, userAccount, payer, route.mintB, mintInfo.value?.owner!))
		}

		transaction.add(Instructions.withdrawSingleTokenTypeExactAmountOutInstruction(
			pool,
			authority,
			payer,
			route.tokenPool,
			route.feeAccount,
			userPoolTokenAccount,
			route.tokenAccountA,
			route.tokenAccountB,
			userAccount,
			dstMint.mint,
			SWAP_PROGRAM_ID,
			TOKEN_2022_PROGRAM_ID,
			mintInfo.value?.owner!,
			new BN(dstMint.amount, 10),
			new BN(poolTokenAmount),
		))

		//Unwrap sol
		if (dstMint.mint.equals(WSOL))
			transaction.add(this.getUnwrapSOLInstruction(payer))

		return transaction
	}


	async getWrapSOLInstructions(owner: web3.PublicKey, amount: number): Promise<web3.TransactionInstruction[]> {
		const ixs: web3.TransactionInstruction[] = []
		const ata = getAssociatedTokenAddressSync(WSOL, owner, false)
		const ataInfo = await this.connection.getTokenAccountBalance(ata).catch(() => {
		})

		if (ataInfo) {
			if (Number(ataInfo?.value.amount) >= amount)
				return ixs;
		}

		if (!ataInfo) {
			ixs.push(createAssociatedTokenAccountInstruction(owner, ata, owner, WSOL))
		}
		if (amount > 0)
			ixs.push(...[
				web3.SystemProgram.transfer({
					fromPubkey: owner,
					toPubkey: ata,
					lamports: amount - Number(ataInfo?.value.amount || 0),
				}),
				createSyncNativeInstruction(ata)
			])

		return ixs
	}

	getUnwrapSOLInstruction(owner: web3.PublicKey): web3.TransactionInstruction {
		const ata = getAssociatedTokenAddressSync(WSOL, owner, false)
		return createCloseAccountInstruction(ata, owner, owner)
	}

	hasTransferFeeConfig(mintInfo: any) : boolean {
		if (!TOKEN_2022_PROGRAM_ID.equals(mintInfo.value?.owner))
			return false

		return mintInfo.value?.data.parsed?.info.extensions?.filter((ex: any) => ex.extension === "transferFeeConfig").length > 0
	}
}