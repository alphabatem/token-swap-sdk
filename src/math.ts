import {TokenSwapPool} from "@/api/token_swap/layouts";
import {TransferFee} from "@solana/spl-token";
import BN from "bn.js";
import {web3} from "@project-serum/anchor";

export default {

	expectedOutput(pool: TokenSwapPool, poolDetail: any, inputMint: web3.PublicKey, inputAmount: BN, aToB: boolean = true): BN {
		if (!pool)
			return new BN(0);

		// Ensure inputs are numbers
		if (inputAmount.isNeg())
			return new BN(0);

		const poolAAmount = new BN(poolDetail.tokenAccountA.tokenAmount.amount);
		const poolBAmount = new BN(poolDetail.tokenAccountB.tokenAmount.amount);

		const inputFees = aToB ? this.mintATransferFee(poolDetail) : this.mintBTransferFee(poolDetail)
		const tokenAFeeRate = (inputFees?.transferFeeBasisPoints! / 10_000) || 0
		if (tokenAFeeRate > 0) {
			let tokenAFee = inputAmount.mul(new BN(tokenAFeeRate))
			const maxFee = new BN(inputFees?.maximumFee.toString()!)
			if (tokenAFee.gt(maxFee))
				tokenAFee = maxFee

			inputAmount = inputAmount.sub(tokenAFee)
			// console.log("Applying tokenAFeeRate", {inputAmount, tokenAFeeRate, tokenAFee})
		}


		let output: BN;
		//Inverse pool
		if (poolDetail.tokenAccountA.mint !== inputMint) {
			output = this.calculateInverseSwapOutput(poolAAmount, poolBAmount, new BN(inputAmount))
		} else {
			output = this.calculateSwapOutput(poolAAmount, poolBAmount, new BN(inputAmount))
		}

		//Pool fees
		const poolRate = this.totalPoolFee(pool).mul(output)
		// console.log("Applying pool rate", this.totalPoolFee, poolRate, output, output - poolRate)
		output = output.sub(poolRate)

		const outputFees = aToB ? this.mintBTransferFee(poolDetail) : this.mintATransferFee(poolDetail)
		const tokenBFeeRate = (outputFees?.transferFeeBasisPoints! / 10_000) || 0
		if (tokenBFeeRate > 0) {
			let tokenBFee = output.mul(new BN(tokenBFeeRate))
			const maxFee = new BN(outputFees?.maximumFee.toString()!)
			if (tokenBFee.gt(maxFee))
				tokenBFee = maxFee

			output = output.sub(tokenBFee)
		}


		console.log("expectedOutput::details", {
			inAmountActual: inputAmount.toString(),
			output: output.toString(),
		})

		// return output
		return output
	},


	lpTokensReceived(tokenAAmount: number, poolTokenAAmount: number, poolSupply: number): BN {
		console.log(`lpTokensReceived`, {tokenAAmount, poolTokenAAmount, poolSupply})
		const tokenAIn = new BN(tokenAAmount);
		const poolTokenA = new BN(poolTokenAAmount);
		const poolSup = new BN(poolSupply)

		if (poolSupply <= 0)
			return new BN(0)

		return tokenAIn.mul(poolSup).div(poolTokenA);
	},

	mintATransferFee(poolDetail: any): TransferFee | null {
		//@ts-ignore
		const tFee = poolDetail?.mintA?.extensions?.filter(ext => ext.extension === "transferFeeConfig")
		if (!tFee || !tFee.length)
			return null

		return tFee[0]?.state?.newerTransferFee;
	},

	mintBTransferFee(poolDetail: any): TransferFee | null {
		//@ts-ignore
		const tFee = poolDetail?.mintB?.extensions?.filter(ext => ext.extension === "transferFeeConfig")
		if (!tFee || !tFee.length)
			return null

		return tFee[0]?.state?.newerTransferFee;
	},


	poolTradeFee(pool: TokenSwapPool): BN {
		if (!pool) return new BN(0)

		return pool.tradeFeeNumerator.div(pool.tradeFeeDenominator)
	},

	poolOwnerTradeFee(pool: TokenSwapPool): BN {
		if (!pool) return new BN(0)

		return pool.ownerTradeFeeNumerator.div(pool.ownerTradeFeeDenominator)
	},

	totalPoolFee(pool: TokenSwapPool): BN {
		return this.poolTradeFee(pool).add(this.poolOwnerTradeFee(pool))
	},


	calculateSwapOutput(beforeTokenA: BN, beforeTokenB: BN, inputA: BN): BN {
		// Calculate the amount of tokenB tokens after the trade
		const afterTokenB = beforeTokenB.mul(beforeTokenA).div(beforeTokenA.add(inputA))

		// Calculate the amount of tokenB received from the trade
		const outputB = beforeTokenB.sub(afterTokenB);
		console.log("calculateSwapOutput", outputB.toString())
		return outputB;
	},

	calculateInverseSwapOutput(beforeTokenA: BN, beforeTokenB: BN, inputB: BN): BN {
		// Calculate the amount of tokenA after the trade
		const afterTokenA = beforeTokenA.mul(beforeTokenB).div(beforeTokenB.add(inputB))

		// Calculate the amount of tokenA received from the trade
		const outputA = beforeTokenA.sub(afterTokenA);
		console.log("calculateInverseSwapOutput", outputA.toString())
		return outputA;
	},

}