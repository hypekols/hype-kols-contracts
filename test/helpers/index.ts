import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

export async function setPredictableTimestamp() {
    const now = BigInt(await time.latest());
    const next = now + 1n;
    await time.setNextBlockTimestamp(next);

    return next;
}