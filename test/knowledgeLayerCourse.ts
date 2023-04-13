import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ContractTransaction } from 'ethers';
import { ethers } from 'hardhat';
import { KnowledgeLayerCourse } from '../typechain-types';

describe('KnowledgeLayerCourse', () => {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    knowledgeLayerCourse: KnowledgeLayerCourse;

  const courseId = 1;
  const courseTitle = 'My cool course';
  const courseSlug = 'my-cool-course';
  const courseDescription =
    'Lorem ipsum dolor sit amet consectetur adipisicing elit. Blanditiis, velit rerum reprehenderit natus omnis eligendi iure amet fugit assumenda cumque id ad qui quos alias odit iusto provident. Nostrum accusamus quae iure quod maiores!';
  const coursePrice = 100;
  const courseImage =
    'https://public-files.gumroad.com/variants/utn8k57wknpyxf1zjp9ij0f8nvpv/e82ce07851bf15f5ab0ebde47958bb042197dbcdcae02aa122ef3f5b41e97c02';
  const videoPlaybackId = 'a915y3226a68zhp7';

  before(async () => {
    [deployer, alice, bob] = await ethers.getSigners();

    const KnowledgeLayerCourse = await ethers.getContractFactory('KnowledgeLayerCourse');
    knowledgeLayerCourse = await KnowledgeLayerCourse.deploy();
    await knowledgeLayerCourse.deployed();
  });

  describe('Create course', async () => {
    before(async () => {
      // Alice creates a course
      const tx = await knowledgeLayerCourse
        .connect(alice)
        .createCourse(
          courseTitle,
          courseSlug,
          courseDescription,
          coursePrice,
          courseImage,
          videoPlaybackId,
        );
      await tx.wait();
    });

    it('Creates product with the correct data', async () => {
      const product = await knowledgeLayerCourse.courses(courseId);
      expect(product.price).to.equal(coursePrice);
      expect(product.seller).to.equal(alice.address);
      expect(product.title).to.equal(courseTitle);
    });
  });

  describe('Buy product', async () => {
    let tx: ContractTransaction;

    before(async () => {
      // Bob buys Alice's product
      tx = await knowledgeLayerCourse.connect(bob).buyCourse(courseId, {
        value: coursePrice,
      });
      await tx.wait();
    });

    it('Mints a product token to Bob', async () => {
      const balance = await knowledgeLayerCourse.balanceOf(bob.address, courseId);
      expect(balance).to.equal(1);
    });

    it("Sends Bob's money to Alice and fee to owner", async () => {
      const fee = coursePrice * 0.05;
      await expect(tx).to.changeEtherBalances(
        [bob, alice, deployer],
        [-coursePrice, coursePrice - fee, fee],
      );
    });
  });

  describe('Update product price', async () => {
    const newPrice = 200;

    before(async () => {
      // Alice updates her product price
      const tx = await knowledgeLayerCourse.connect(alice).updateCoursePrice(courseId, newPrice);
      await tx.wait();
    });

    it('Updates the product price', async () => {
      const price = (await knowledgeLayerCourse.courses(courseId)).price;
      expect(price).to.equal(newPrice);
    });

    it('Only the owner can update the product price', async () => {
      const tx = knowledgeLayerCourse.connect(bob).updateCoursePrice(courseId, newPrice);
      expect(tx).to.be.revertedWith('Only seller can update price');
    });
  });

  describe('Token transfers', async () => {
    it("Tokens can't be transferred", async () => {
      const tx = knowledgeLayerCourse
        .connect(bob)
        .safeTransferFrom(bob.address, alice.address, courseId, 1, []);

      await expect(tx).to.be.revertedWith('Token transfer is not allowed');

      const tx2 = knowledgeLayerCourse
        .connect(bob)
        .safeBatchTransferFrom(bob.address, alice.address, [courseId], [1], []);

      await expect(tx2).to.be.revertedWith('Token transfer is not allowed');
    });
  });
});
