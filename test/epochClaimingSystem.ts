import { time } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber, ContractTransaction } from 'ethers';
import { ethers } from 'hardhat';
import {
  ERC20,
  KnowledgeLayerCourse,
  KnowledgeLayerEscrow,
  KnowledgeLayerID,
  KnowledgeLayerPlatformID,
} from '../typechain-types';
import { deploy } from '../utils/deploy';
import {
  FEE_DIVIDER,
  MintStatus,
  ETH_ADDRESS,
  META_EVIDENCE_CID,
  PROTOCOL_INDEX,
} from '../utils/constants';

const escrowTests = (isEth: boolean) => {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    carol: SignerWithAddress,
    dave: SignerWithAddress,
    eve: SignerWithAddress,
    frank: SignerWithAddress,
    knowledgeLayerID: KnowledgeLayerID,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID,
    knowledgeLayerCourse: KnowledgeLayerCourse,
    knowledgeLayerEscrow: KnowledgeLayerEscrow,
    simpleERC20: ERC20,
    transactionTotalAmount: BigNumber,
    epochBeginning: BigNumber,
    epochDuration: BigNumber,
    protocolFee: number,
    tokenAddress: string;

  const aliceId = 1;
  const bobId = 2;
  const eveId = 3;
  const frankId = 4;
  const originPlatformId = 1;
  const buyPlatformId = 2;
  const originFee = 200;
  const buyFee = 300;
  const courseId = 1;
  const coursePrice = ethers.utils.parseEther('0.01');
  const courseDisputePeriod = BigNumber.from(60 * 60 * 24 * 2.5); // 2.5 days
  const courseDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMf';
  const firstTransactionId = 1;
  const secondTransactionId = 2;
  const thirdTransactionId = 3;
  const transactionAmount = coursePrice;

  before(async () => {
    [deployer, alice, bob, carol, dave, eve, frank] = await ethers.getSigners();
    [knowledgeLayerID, knowledgeLayerPlatformID, knowledgeLayerCourse, knowledgeLayerEscrow] =
      await deploy();

    epochBeginning = await knowledgeLayerEscrow.epochBeginning();
    epochDuration = await knowledgeLayerEscrow.EPOCH_DURATION();

    if (!isEth) {
      // Deploy SimpleERC20
      const SimpleERC20 = await ethers.getContractFactory('SimpleERC20');
      simpleERC20 = await SimpleERC20.deploy();
      simpleERC20.deployed();
      tokenAddress = simpleERC20.address;

      // Send tokens to Bob and Eve
      simpleERC20.connect(deployer).transfer(bob.address, ethers.utils.parseEther('1000'));
      simpleERC20.connect(deployer).transfer(eve.address, ethers.utils.parseEther('1000'));
      simpleERC20.connect(deployer).transfer(frank.address, ethers.utils.parseEther('1000'));
    } else {
      tokenAddress = ETH_ADDRESS;
    }

    // Add carol to whitelist and mint platform ID
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(carol.address);
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(dave.address);
    await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
    await knowledgeLayerPlatformID.connect(dave).mint('dave-platform');

    // Update platform fees
    await knowledgeLayerPlatformID.connect(carol).updateOriginFee(originPlatformId, originFee);
    await knowledgeLayerPlatformID.connect(dave).updateBuyFee(buyPlatformId, buyFee);

    // Mint KnowledgeLayer IDs
    await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);
    await knowledgeLayerID.connect(alice).mint(originPlatformId, 'alice');
    await knowledgeLayerID.connect(bob).mint(originPlatformId, 'bob__');
    await knowledgeLayerID.connect(eve).mint(originPlatformId, 'eve__');
    await knowledgeLayerID.connect(frank).mint(originPlatformId, 'frank');

    // Alice creates a course
    await knowledgeLayerCourse
      .connect(alice)
      .createCourse(
        aliceId,
        originPlatformId,
        coursePrice,
        tokenAddress,
        courseDisputePeriod,
        courseDataUri,
      );

    protocolFee = await knowledgeLayerEscrow.protocolFee();
    transactionTotalAmount = transactionAmount.add(
      transactionAmount.mul(originFee + buyFee + protocolFee).div(FEE_DIVIDER),
    );
  });

  describe('Epoch calculation', async () => {
    it('Epoch beginning is set correctly', async () => {
      const deployBlockHash = knowledgeLayerEscrow.deployTransaction.blockHash;
      if (!deployBlockHash) throw new Error();
      const deployBlock = await ethers.provider.getBlock(deployBlockHash);

      expect(epochBeginning).to.be.equal(deployBlock.timestamp);

      const currentEpoch = await knowledgeLayerEscrow.getCurrentEpoch();
      expect(currentEpoch).to.be.equal(0);
    });

    it('Current epoch is calculated correctly', async () => {
      const epochDuration = await knowledgeLayerEscrow.EPOCH_DURATION();
      const epochsIncrease = 3;
      await time.increase(epochDuration.mul(epochsIncrease));

      const currentEpoch = await knowledgeLayerEscrow.getCurrentEpoch();
      expect(currentEpoch).to.be.equal(epochsIncrease);

      const epochsIncrease2 = 4.5;
      await time.increase(epochDuration.mul(epochsIncrease2 * 2).div(2)); // mul and div by 2 to avoid overflow
      const currentEpoch2 = await knowledgeLayerEscrow.getCurrentEpoch();

      expect(currentEpoch2).to.be.equal(epochsIncrease + Math.floor(epochsIncrease2));
    });
  });

  describe('Create first transaction', async () => {
    let releasableAt: BigNumber;

    before(async () => {
      if (!isEth) {
        // Approve tokens to escrow
        await simpleERC20
          .connect(bob)
          .approve(knowledgeLayerEscrow.address, transactionTotalAmount);
      }

      // Bob buys Alice's course
      await knowledgeLayerEscrow
        .connect(bob)
        .createTransaction(bobId, courseId, buyPlatformId, META_EVIDENCE_CID, {
          value: isEth ? transactionTotalAmount : 0,
        });
    });

    it('Correctly updates transaction releasable time', async () => {
      const transaction = await knowledgeLayerEscrow
        .connect(alice)
        .getTransaction(firstTransactionId);

      const lastBlockTimestamp = BigNumber.from(await time.latest());
      releasableAt = lastBlockTimestamp.add(courseDisputePeriod);

      expect(transaction.releasableAt).to.equal(releasableAt);
    });

    it('The releasable epoch is calculated correctly', async () => {
      const releasableEpoch = await knowledgeLayerEscrow.getReleasableEpoch(firstTransactionId);
      const expectedReleasableEpoch = releasableAt.sub(epochBeginning).div(epochDuration).add(1);

      expect(releasableEpoch).to.be.equal(expectedReleasableEpoch);
    });

    it('Updates the releasable balance', async () => {
      // The releasable balance for the epoch is the transaction amount, since it's the first transaction
      const releasableEpoch = await knowledgeLayerEscrow.getReleasableEpoch(firstTransactionId);
      const releasableBalance = await knowledgeLayerEscrow.releasableBalanceByEpoch(
        courseId,
        releasableEpoch,
      );

      expect(releasableBalance).to.be.equal(transactionAmount);
    });

    it('Updates the platform releasable balance', async () => {
      const releasableEpoch = await knowledgeLayerEscrow.getReleasableEpoch(firstTransactionId);
      const protocolFeeAmount = transactionAmount.mul(protocolFee).div(FEE_DIVIDER);
      const originPlatformFeeAmount = transactionAmount.mul(originFee).div(FEE_DIVIDER);
      const buyPlatformFeeAmount = transactionAmount.mul(buyFee).div(FEE_DIVIDER);

      const protocolReleasableBalance = await knowledgeLayerEscrow.platformReleasableBalanceByEpoch(
        PROTOCOL_INDEX,
        ETH_ADDRESS,
        releasableEpoch,
      );
      const originPlatformReleasableBalance =
        await knowledgeLayerEscrow.platformReleasableBalanceByEpoch(
          originPlatformId,
          ETH_ADDRESS,
          releasableEpoch,
        );
      const buyPlatformReleasableBalance =
        await knowledgeLayerEscrow.platformReleasableBalanceByEpoch(
          buyPlatformId,
          ETH_ADDRESS,
          releasableEpoch,
        );

      expect(protocolReleasableBalance).to.be.equal(protocolFeeAmount);
      expect(originPlatformReleasableBalance).to.be.equal(originPlatformFeeAmount);
      expect(buyPlatformReleasableBalance).to.be.equal(buyPlatformFeeAmount);
    });

    it('The current releasable balance for the course is zero', async () => {
      // The current releasable balance for the course is zero, since no epoch has passed since the transaction
      const releasableBalance = await knowledgeLayerEscrow.getReleasableBalance(courseId);
      expect(releasableBalance).to.be.equal(0);
    });
  });

  describe('Create second transaction', async () => {
    before(async () => {
      if (!isEth) {
        // Approve tokens to escrow
        await simpleERC20
          .connect(eve)
          .approve(knowledgeLayerEscrow.address, transactionTotalAmount);
      }

      // Eve buys Alice's course. Transaction is in the same epoch as the previous one
      await knowledgeLayerEscrow
        .connect(eve)
        .createTransaction(eveId, courseId, buyPlatformId, META_EVIDENCE_CID, {
          value: isEth ? transactionTotalAmount : 0,
        });
    });

    it('Updates the releasable balance for the epoch correctly', async () => {
      // The transaction is in the same epoch as the previous one, so the releasable epoch is the same
      const firstReleasableEpoch = await knowledgeLayerEscrow.getReleasableEpoch(
        firstTransactionId,
      );
      const secondReleasableEpoch = await knowledgeLayerEscrow.getReleasableEpoch(
        secondTransactionId,
      );
      expect(firstReleasableEpoch).to.be.equal(secondReleasableEpoch);

      // The transactions will become releasable in the same epoch
      // so the releasable balance for the epoch is the transaction amount * 2
      const releasableBalance = await knowledgeLayerEscrow.releasableBalanceByEpoch(
        courseId,
        secondReleasableEpoch,
      );

      expect(releasableBalance).to.be.equal(transactionAmount.mul(2));
    });
  });

  describe('Create third transaction', async () => {
    before(async () => {
      // Transaction is in the next epoch relative to the previous two
      await time.increase(epochDuration);

      if (!isEth) {
        // Approve tokens to escrow
        await simpleERC20
          .connect(frank)
          .approve(knowledgeLayerEscrow.address, transactionTotalAmount);
      }

      // Eve buys Alice's course
      await knowledgeLayerEscrow
        .connect(frank)
        .createTransaction(frankId, courseId, buyPlatformId, META_EVIDENCE_CID, {
          value: isEth ? transactionTotalAmount : 0,
        });
    });

    it('Updates the releasable balance for the epoch correctly', async () => {
      // The transaction is in the next epoch relative to the previous two
      // so the releasable epoch is also the next one relative to the previous two
      const secondReleasableEpoch = await knowledgeLayerEscrow.getReleasableEpoch(
        secondTransactionId,
      );
      const thirdReleasableEpoch = await knowledgeLayerEscrow.getReleasableEpoch(
        thirdTransactionId,
      );
      expect(thirdReleasableEpoch).to.be.equal(secondReleasableEpoch.add(1));

      // The transactions will become releasable in the next epoch relative to the previous two
      // so the releasable balance for the epoch of the second transaction is still the transaction amount * 2
      const secondReleasableBalance = await knowledgeLayerEscrow.releasableBalanceByEpoch(
        courseId,
        secondReleasableEpoch,
      );
      expect(secondReleasableBalance).to.be.equal(transactionAmount.mul(2));

      // The releasable balance for the epoch of the third transaction is the transaction amount
      const thirdReleasableBalance = await knowledgeLayerEscrow.releasableBalanceByEpoch(
        courseId,
        thirdReleasableEpoch,
      );
      expect(thirdReleasableBalance).to.be.equal(transactionAmount);
    });
  });

  describe('Dispute period expires', async () => {
    it('The current releasable balance for the course is calculated correctly', async () => {
      // The dispute period expires for the first two transactions.
      // TODO: do math to see why here is already releasable. Is already in next epoch?
      await time.increase(courseDisputePeriod);
      const releasableBalance = await knowledgeLayerEscrow.getReleasableBalance(courseId);
      expect(releasableBalance).to.be.equal(transactionAmount.mul(2));

      // The dispute period expires also for the third transaction.
      const epochDuration = await knowledgeLayerEscrow.EPOCH_DURATION();
      await time.increase(epochDuration);
      const releasableBalance2 = await knowledgeLayerEscrow.getReleasableBalance(courseId);
      expect(releasableBalance2).to.be.equal(transactionAmount.mul(3));
    });
  });

  describe('Release second transaction individually', async () => {
    let tx: ContractTransaction, releasableEpoch: BigNumber, releasableBalanceBefore: BigNumber;

    before(async () => {
      // Release second transaction
      releasableEpoch = await knowledgeLayerEscrow.getReleasableEpoch(secondTransactionId);
      releasableBalanceBefore = await knowledgeLayerEscrow.releasableBalanceByEpoch(
        courseId,
        releasableEpoch,
      );
      tx = await knowledgeLayerEscrow.connect(alice).release(aliceId, secondTransactionId);
    });

    it('Sends funds to the receiver', async () => {
      if (isEth) {
        await expect(tx).to.changeEtherBalances(
          [knowledgeLayerEscrow, alice],
          [transactionAmount.mul(-1), transactionAmount],
        );
      } else {
        await expect(tx).to.changeTokenBalances(
          simpleERC20,
          [knowledgeLayerEscrow, alice],
          [transactionAmount.mul(-1), transactionAmount],
        );
      }
    });

    it('Updates releasable balance by epoch', async () => {
      const releasableBalance = await knowledgeLayerEscrow.releasableBalanceByEpoch(
        courseId,
        releasableEpoch,
      );
      expect(releasableBalance).to.be.equal(releasableBalanceBefore.sub(transactionAmount));
    });

    it('Updates current releasable balance', async () => {
      const releasableBalance = await knowledgeLayerEscrow.getReleasableBalance(courseId);
      expect(releasableBalance).to.be.equal(transactionAmount.mul(2));
    });
  });

  describe('Release all funds', async () => {
    it("Fails if not the course's owner", async () => {
      await expect(
        knowledgeLayerEscrow.connect(bob).releaseAll(bobId, courseId),
      ).to.be.revertedWith('Not the owner');
    });

    describe('Successfull release of all funds', async () => {
      let tx: ContractTransaction, releasableBalance: BigNumber;

      before(async () => {
        releasableBalance = await knowledgeLayerEscrow.getReleasableBalance(courseId);

        // Release all funds
        tx = await knowledgeLayerEscrow.connect(alice).releaseAll(aliceId, courseId);
      });

      it('Transfers the funds of all the transactions to the course owner', async () => {
        if (isEth) {
          await expect(tx).to.changeEtherBalances(
            [alice, knowledgeLayerEscrow],
            [releasableBalance, releasableBalance.mul(-1)],
          );
        } else {
          await expect(tx).to.changeTokenBalances(
            simpleERC20,
            [alice, knowledgeLayerEscrow],
            [releasableBalance, releasableBalance.mul(-1)],
          );
        }
      });

      it('Updates last released epoch to the current epoch', async () => {
        const currentEpoch = await knowledgeLayerEscrow.getCurrentEpoch();
        const lastReleasedEpoch = await knowledgeLayerEscrow.lastReleasedEpoch(courseId);
        expect(lastReleasedEpoch).to.be.equal(currentEpoch);
      });

      it('The current releasable balance for the course is zero', async () => {
        const releasableBalance = await knowledgeLayerEscrow.getReleasableBalance(courseId);
        expect(releasableBalance).to.be.equal(0);
      });

      it("Can't individually release a transaction if it's already been released in batch", async () => {
        const releasableEpoch = await knowledgeLayerEscrow.getReleasableEpoch(firstTransactionId);
        const lastReleasedEpoch = await knowledgeLayerEscrow.lastReleasedEpoch(courseId);

        expect(lastReleasedEpoch).to.be.greaterThan(releasableEpoch);

        const tx = knowledgeLayerEscrow.connect(alice).release(aliceId, firstTransactionId);
        await expect(tx).to.be.revertedWith('Transaction already released');
      });

      it("Can't release all funds again", async () => {
        const tx = knowledgeLayerEscrow.connect(alice).releaseAll(aliceId, courseId);
        await expect(tx).to.be.revertedWith('No balance to release');
      });
    });
  });
};

describe.only('Epoch Claiming System', () => {
  describe('ETH', () => escrowTests(true));

  // describe('ERC20', () => escrowTests(false));
});
