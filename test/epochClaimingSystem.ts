import { time } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import {
  ERC20,
  KnowledgeLayerCourse,
  KnowledgeLayerEscrow,
  KnowledgeLayerID,
  KnowledgeLayerPlatformID,
} from '../typechain-types';
import { deploy } from '../utils/deploy';
import { FEE_DIVIDER, MintStatus, ETH_ADDRESS, META_EVIDENCE_CID } from '../utils/constants';

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
    epochBeginning: BigNumber,
    epochDuration: BigNumber,
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
  const courseDisputePeriod = BigNumber.from(60 * 60 * 24 * 2.5); // 2.5 days
  const courseDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMf';
  const transactionId = 1;

  before(async () => {
    [deployer, alice, bob, carol, dave] = await ethers.getSigners();
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

  describe('Create transaction (buy course)', async () => {
    let releasableAt: BigNumber;

    before(async () => {
      if (!isEth) {
        // Send tokens to Bob
        const balance = await simpleERC20.balanceOf(deployer.address);
        simpleERC20.connect(deployer).transfer(bob.address, balance);

        // Approve tokens to escrow
        await simpleERC20.connect(bob).approve(knowledgeLayerEscrow.address, courseTotalPrice);
      }

      // Bob buys Alice's course
      await knowledgeLayerEscrow
        .connect(bob)
        .createTransaction(bobId, courseId, buyPlatformId, META_EVIDENCE_CID, {
          value: isEth ? courseTotalPrice : 0,
        });
    });

    it('Correctly updates transaction releasable time', async () => {
      const transaction = await knowledgeLayerEscrow.connect(alice).getTransaction(transactionId);

      const lastBlockTimestamp = BigNumber.from(await time.latest());
      releasableAt = lastBlockTimestamp.add(courseDisputePeriod);

      expect(transaction.releasableAt).to.equal(releasableAt);
    });

    it('The releasable epoch is calculated correctly', async () => {
      const releasableEpoch = await knowledgeLayerEscrow.getReleasableEpoch(transactionId);
      const expectedReleasableEpoch = releasableAt.sub(epochBeginning).div(epochDuration).add(1);

      expect(releasableEpoch).to.be.equal(expectedReleasableEpoch);
    });

    it('Updates the releasable balance for the epoch correctly', async () => {
      const releasableEpoch = await knowledgeLayerEscrow.getReleasableEpoch(transactionId);
      const releasableBalance = await knowledgeLayerEscrow.releasableBalanceByEpoch(
        courseId,
        releasableEpoch,
      );

      expect(releasableBalance).to.be.equal(coursePrice);
    });

    it('The current releasable balance for the course is zero', async () => {
      const releasableBalance = await knowledgeLayerEscrow.getReleasableBalance(courseId);
      expect(releasableBalance).to.be.equal(0);
    });
  });

  describe('Dispute period expires', async () => {
    before(async () => {
      const epochDuration = await knowledgeLayerEscrow.EPOCH_DURATION();
      await time.increase(courseDisputePeriod.add(epochDuration));
    });

    it('The current releasable balance for the course is calculated correctly', async () => {
      const releasableBalance = await knowledgeLayerEscrow.getReleasableBalance(courseId);
      expect(releasableBalance).to.be.equal(coursePrice);
    });
  });
};

describe.only('Epoch Claiming System', () => {
  describe('ETH', () => escrowTests(true));

  // describe('ERC20', () => escrowTests(false));
});
