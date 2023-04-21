import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, ContractTransaction } from 'ethers';
import { ethers } from 'hardhat';
import {
  KnowledgeLayerCourse,
  KnowledgeLayerEscrow,
  KnowledgeLayerID,
  KnowledgeLayerPlatformID,
} from '../typechain-types';
import uploadToIPFS from '../utils/uploadToIpfs';
import deploy from '../utils/deploy';
import { MintStatus } from '../utils/constants';
import { expect } from 'chai';

describe('Full Workflow', () => {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    aliceId: BigNumber,
    bob: SignerWithAddress,
    bobId: BigNumber,
    carol: SignerWithAddress,
    carolPlatformId: BigNumber,
    knowledgeLayerID: KnowledgeLayerID,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID,
    knowledgeLayerCourse: KnowledgeLayerCourse,
    knowledgerLayerEscrow: KnowledgeLayerEscrow;

  const courseData = {
    title: 'My cool course',
    description:
      'Lorem ipsum dolor sit amet consectetur adipisicing elit. Blanditiis, velit rerum reprehenderit natus omnis eligendi iure amet fugit assumenda cumque id ad qui quos alias odit iusto provident. Nostrum accusamus quae iure quod maiores!',
    image:
      'https://yvgbeqzuvfqmewtltglq.supabase.co/storage/v1/object/public/public/16814021907992.webp',
    videoPlaybackId: 'a915y3226a68zhp7',
  };

  const courseId = 1;
  const coursePrice = 100;

  before(async () => {
    [deployer, alice, bob, carol] = await ethers.getSigners();
    [knowledgeLayerID, knowledgeLayerPlatformID, knowledgeLayerCourse, knowledgerLayerEscrow] =
      await deploy();

    // Add carol to whitelist and mint platform ID
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(carol.address);
    await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
    carolPlatformId = await knowledgeLayerPlatformID.connect(carol).ids(carol.address);

    // Disable whitelist and mint IDs
    await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);
    await knowledgeLayerID.connect(alice).mint(0, 'alice');
    await knowledgeLayerID.connect(bob).mint(0, 'bob__');

    aliceId = await knowledgeLayerID.connect(alice).ids(alice.address);
    bobId = await knowledgeLayerID.connect(bob).ids(bob.address);

    // Alice creates a course
    const uri = await uploadToIPFS(courseData);
    if (!uri) throw new Error('Failed to upload to IPFS');

    await knowledgeLayerCourse
      .connect(alice)
      .createCourse(aliceId, carolPlatformId, coursePrice, uri);
  });

  describe('Buy course', async () => {
    let tx: ContractTransaction;

    before(async () => {
      // Bob buys Alice's course
      tx = await knowledgerLayerEscrow.connect(bob).createTransaction(bobId, courseId, {
        value: coursePrice,
      });
      await tx.wait();
    });

    it('Mints a course token to Bob', async () => {
      const balance = await knowledgeLayerCourse.balanceOf(bob.address, courseId);
      expect(balance).to.equal(1);
    });

    it("Sends Bob's money to Alice and fee to owner", async () => {
      await expect(tx).to.changeEtherBalances(
        [bob, knowledgerLayerEscrow],
        [-coursePrice, coursePrice],
      );
    });
  });
});
