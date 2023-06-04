import { time } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber, ContractTransaction, Wallet } from 'ethers';
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
  PROTOCOL_INDEX,
  ETH_ADDRESS,
  META_EVIDENCE_CID,
} from '../utils/constants';

const escrowTests = (isEth: boolean) => {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    carol: SignerWithAddress,
    dave: SignerWithAddress,
    knowledgeLayerID: KnowledgeLayerID,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID,
    knowledgeLayerCourse: KnowledgeLayerCourse,
    knowledgeLayerEscrow: KnowledgeLayerEscrow,
    simpleERC20: ERC20,
    courseTotalPrice: BigNumber,
    protocolFee: number,
    tokenAddress: string;

  const aliceId = 1;
  const bobId = 2;
  const originPlatformId = 1;
  const buyPlatformId = 2;
  const originFee = 200;
  const buyFee = 300;
  const courseId = 1;
  const coursePrice = ethers.utils.parseEther('0.01');
  const courseDisputePeriod = 60 * 60 * 24 * 7; // 7 days
  const courseDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMf';
  const transactionId = 1;

  before(async () => {
    [deployer, alice, bob, carol, dave] = await ethers.getSigners();
    [knowledgeLayerID, knowledgeLayerPlatformID, knowledgeLayerCourse, knowledgeLayerEscrow] =
      await deploy();

    if (!isEth) {
      // Deploy SimpleERC20
      const SimpleERC20 = await ethers.getContractFactory('SimpleERC20');
      simpleERC20 = await SimpleERC20.deploy();
      simpleERC20.deployed();
      tokenAddress = simpleERC20.address;
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
    await knowledgeLayerID.connect(carol).mint(originPlatformId, 'carol');

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
    courseTotalPrice = coursePrice.add(
      coursePrice.mul(originFee + buyFee + protocolFee).div(FEE_DIVIDER),
    );
  });

  describe('Create transaction (buy course)', async () => {
    it("Can't buy course if not profile owner", async () => {
      await expect(
        knowledgeLayerEscrow
          .connect(carol)
          .createTransaction(bobId, courseId, buyPlatformId, META_EVIDENCE_CID, {
            value: isEth ? courseTotalPrice : 0,
          }),
      ).to.be.revertedWith('Not the owner');
    });

    it("Can't buy course if not paying enough", async () => {
      if (isEth) {
        await expect(
          knowledgeLayerEscrow
            .connect(bob)
            .createTransaction(bobId, courseId, buyPlatformId, META_EVIDENCE_CID, {
              value: courseTotalPrice.sub(1),
            }),
        ).to.be.revertedWith('Non-matching funds');
      } else {
        // Create transaction without approving tokens
        await expect(
          knowledgeLayerEscrow
            .connect(bob)
            .createTransaction(bobId, courseId, buyPlatformId, META_EVIDENCE_CID, {
              value: 0,
            }),
        ).to.be.revertedWith('ERC20: insufficient allowance');
      }
    });

    describe('Successfull purchase of course', async () => {
      let tx: ContractTransaction;

      before(async () => {
        if (!isEth) {
          // Send tokens to Bob
          const balance = await simpleERC20.balanceOf(deployer.address);
          simpleERC20.connect(deployer).transfer(bob.address, balance);

          // Approve tokens to escrow
          await simpleERC20.connect(bob).approve(knowledgeLayerEscrow.address, courseTotalPrice);
        }

        // Bob buys Alice's course
        tx = await knowledgeLayerEscrow
          .connect(bob)
          .createTransaction(bobId, courseId, buyPlatformId, META_EVIDENCE_CID, {
            value: isEth ? courseTotalPrice : 0,
          });
      });

      it('Create a transaction with the correct data', async () => {
        const transaction = await knowledgeLayerEscrow.connect(alice).getTransaction(transactionId);
        expect(transaction.sender).to.equal(bob.address);
        expect(transaction.receiver).to.equal(alice.address);
        expect(transaction.token).to.equal(tokenAddress);
        expect(transaction.amount).to.equal(coursePrice);
        expect(transaction.courseId).to.equal(courseId);
        expect(transaction.buyPlatformId).to.equal(buyPlatformId);
        expect(transaction.protocolFee).to.equal(protocolFee);
        expect(transaction.originFee).to.equal(originFee);
        expect(transaction.buyFee).to.equal(buyFee);

        const lastBlockTimestamp = await time.latest();
        expect(transaction.releasableAt).to.equal(lastBlockTimestamp + courseDisputePeriod);
      });

      it('Mints a course token to the buyer', async () => {
        const balance = await knowledgeLayerCourse.balanceOf(bob.address, courseId);
        expect(balance).to.equal(1);
      });

      it('Sends funds to escrow', async () => {
        if (isEth) {
          await expect(tx).to.changeEtherBalances(
            [bob, knowledgeLayerEscrow],
            [courseTotalPrice.mul(-1), courseTotalPrice],
          );
        } else {
          await expect(tx).to.changeTokenBalances(
            simpleERC20,
            [bob, knowledgeLayerEscrow],
            [courseTotalPrice.mul(-1), courseTotalPrice],
          );
        }
      });
    });
  });

  describe('Get transaction details', async () => {
    it("Can't get transaction details if not sender or receiver", async () => {
      expect(knowledgeLayerEscrow.connect(carol).getTransaction(transactionId)).to.be.revertedWith(
        'You are not related to this transaction',
      );
    });

    it("Can't get transaction details if sender or receiver", async () => {
      expect(await knowledgeLayerEscrow.connect(alice).getTransaction(transactionId)).to.not.be
        .reverted;
      expect(await knowledgeLayerEscrow.connect(bob).getTransaction(transactionId)).to.not.be
        .reverted;
    });
  });

  describe('Release funds to seller', async () => {
    it("Can't release funds if transaction does't exist", async () => {
      await expect(knowledgeLayerEscrow.connect(alice).release(aliceId, 2)).to.be.revertedWith(
        'Invalid transaction id',
      );
    });

    it("Can't release funds if not transaction receiver", async () => {
      await expect(
        knowledgeLayerEscrow.connect(bob).release(bobId, transactionId),
      ).to.be.revertedWith('Not the receiver');
    });

    it("Can't release funds if not dispute period is not over", async () => {
      await expect(
        knowledgeLayerEscrow.connect(alice).release(aliceId, transactionId),
      ).to.be.revertedWith('Not yet releasable');
    });

    describe('Successfull release of funds by receiver', async () => {
      let tx: ContractTransaction;

      before(async () => {
        // Alice claims the funds
        await time.increase(courseDisputePeriod);
        tx = await knowledgeLayerEscrow.connect(alice).release(aliceId, transactionId);
        await tx.wait();
      });

      it('Sends funds to the receiver', async () => {
        if (isEth) {
          await expect(tx).to.changeEtherBalances(
            [knowledgeLayerEscrow, alice],
            [coursePrice.mul(-1), coursePrice],
          );
        } else {
          await expect(tx).to.changeTokenBalances(
            simpleERC20,
            [knowledgeLayerEscrow, alice],
            [coursePrice.mul(-1), coursePrice],
          );
        }
      });

      it('Updates platforms fees balance', async () => {
        const originFeeAmount = coursePrice.mul(originFee).div(FEE_DIVIDER);
        const buyFeeAmount = coursePrice.mul(buyFee).div(FEE_DIVIDER);

        const currentEpoch = await knowledgeLayerEscrow.getCurrentEpoch();
        const originPlatformBalance = await knowledgeLayerEscrow.platformBalanceByEpoch(
          originPlatformId,
          tokenAddress,
          currentEpoch.add(1),
        );
        const buyPlatformBalance = await knowledgeLayerEscrow.platformBalanceByEpoch(
          buyPlatformId,
          tokenAddress,
          currentEpoch.add(1),
        );

        expect(originPlatformBalance).to.equal(originFeeAmount);
        expect(buyPlatformBalance).to.equal(buyFeeAmount);
      });

      it('Updates protocol fees balance', async () => {
        const protocolFeeAmount = coursePrice.mul(protocolFee).div(FEE_DIVIDER);
        const currentEpoch = await knowledgeLayerEscrow.getCurrentEpoch();
        const protocolBalance = await knowledgeLayerEscrow.platformBalanceByEpoch(
          PROTOCOL_INDEX,
          tokenAddress,
          currentEpoch.add(1),
        );
        expect(protocolBalance).to.equal(protocolFeeAmount);
      });
    });
  });

  describe('Claim platform fees', async () => {
    it("Owner can't claim platform fees", async () => {
      await expect(
        knowledgeLayerEscrow.connect(deployer).claim(originPlatformId, tokenAddress),
      ).to.be.revertedWith('Access denied');
    });

    describe('Successfull claim of funds by owner', async () => {
      let tx: ContractTransaction, originPlatformBalance: BigNumber, currentEpoch: BigNumber;

      before(async () => {
        // Advance time to next epoch so that platform fees become claimable
        const epochDuration = await knowledgeLayerEscrow.EPOCH_DURATION();
        await time.increase(epochDuration);

        currentEpoch = await knowledgeLayerEscrow.getCurrentEpoch();
        originPlatformBalance = await knowledgeLayerEscrow.platformBalanceByEpoch(
          originPlatformId,
          tokenAddress,
          currentEpoch,
        );

        // Carol claims platform fees
        tx = await knowledgeLayerEscrow.connect(carol).claim(originPlatformId, tokenAddress);
        await tx.wait();
      });

      it('Sends funds to the platform owner', async () => {
        if (isEth) {
          await expect(tx).to.changeEtherBalances(
            [carol, knowledgeLayerEscrow],
            [originPlatformBalance, originPlatformBalance.mul(-1)],
          );
        } else {
          await expect(tx).to.changeTokenBalances(
            simpleERC20,
            [carol, knowledgeLayerEscrow],
            [originPlatformBalance, originPlatformBalance.mul(-1)],
          );
        }
      });

      it('Claimable balance becomes 0', async () => {
        const claimableBalance = await knowledgeLayerEscrow.getPlatformClaimableBalance(
          originPlatformId,
          tokenAddress,
        );
        expect(claimableBalance).to.equal(0);
      });

      it('Updates the last claimed epoch', async () => {
        const lastClaimedEpoch = await knowledgeLayerEscrow.platformLastClaimedEpoch(
          originPlatformId,
          tokenAddress,
        );
        expect(lastClaimedEpoch).to.equal(currentEpoch);
      });
    });
  });

  describe('Claim protocol fees', async () => {
    let tx: ContractTransaction, protocolBalance: BigNumber, currentEpoch: BigNumber;

    before(async () => {
      currentEpoch = await knowledgeLayerEscrow.getCurrentEpoch();
      protocolBalance = await knowledgeLayerEscrow.platformBalanceByEpoch(
        PROTOCOL_INDEX,
        tokenAddress,
        currentEpoch,
      );

      // Owner claims protocol fees
      tx = await knowledgeLayerEscrow.connect(deployer).claim(PROTOCOL_INDEX, tokenAddress);
      await tx.wait();
    });

    it('Sends funds to the platform owner', async () => {
      const protocolTreasuryAddress = await knowledgeLayerEscrow.protocolTreasuryAddress();

      if (isEth) {
        await expect(tx).to.changeEtherBalances(
          [protocolTreasuryAddress, knowledgeLayerEscrow],
          [protocolBalance, protocolBalance.mul(-1)],
        );
      } else {
        await expect(tx).to.changeTokenBalances(
          simpleERC20,
          [protocolTreasuryAddress, knowledgeLayerEscrow],
          [protocolBalance, protocolBalance.mul(-1)],
        );
      }
    });

    it('Claimable balance becomes 0', async () => {
      const claimableBalance = await knowledgeLayerEscrow.getPlatformClaimableBalance(
        PROTOCOL_INDEX,
        tokenAddress,
      );
      expect(claimableBalance).to.equal(0);
    });

    it('Updates the last claimed epoch', async () => {
      const lastClaimedEpoch = await knowledgeLayerEscrow.platformLastClaimedEpoch(
        PROTOCOL_INDEX,
        tokenAddress,
      );
      expect(lastClaimedEpoch).to.equal(currentEpoch);
    });
  });

  describe('Update protocol fee', async () => {
    const newProtocolFee = 200;

    it("Can't update origin fee if not owner", async () => {
      const tx = knowledgeLayerEscrow.connect(alice).setProtocolFee(newProtocolFee);
      await expect(tx).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Can update origin fee if platform owner', async () => {
      await knowledgeLayerEscrow.connect(deployer).setProtocolFee(newProtocolFee);
      const protocolFee = await knowledgeLayerEscrow.protocolFee();
      expect(protocolFee).to.equal(newProtocolFee);
    });
  });

  describe('Update protocool treasury address', async () => {
    const newProtocolTreasuryAddress = Wallet.createRandom().address;

    it("Can't update origin fee if not owner", async () => {
      const tx = knowledgeLayerEscrow
        .connect(alice)
        .setProtocolTreasuryAddress(newProtocolTreasuryAddress);
      await expect(tx).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Can update origin fee if platform owner', async () => {
      await knowledgeLayerEscrow
        .connect(deployer)
        .setProtocolTreasuryAddress(newProtocolTreasuryAddress);
      const protocolTreasuryAddress = await knowledgeLayerEscrow.protocolTreasuryAddress();
      expect(protocolTreasuryAddress).to.equal(newProtocolTreasuryAddress);
    });
  });
};

describe('KnowledgeLayerEscrow', () => {
  describe.only('ETH', () => escrowTests(true));

  describe('ERC20', () => escrowTests(false));
});
