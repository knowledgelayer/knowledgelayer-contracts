#!make
include .env

# -------------- DEPLOYMENT -------------- #

deploy: 
	npx hardhat run scripts/deploy.ts --network $(NETWORK)

#-------------- PLAYGROUND ----------------#

mint-platform-id:
	npx hardhat run scripts/playground/0-mintPlatformId.ts --network $(NETWORK)

mint-id:
	npx hardhat run scripts/playground/1-mintId.ts --network $(NETWORK)

create-course:
	npx hardhat run scripts/playground/2-createCourse.ts --network $(NETWORK)

buy-course:
	npx hardhat run scripts/playground/3-buyCourse.ts --network $(NETWORK)

get-uri:
	npx hardhat run scripts/get-uri.ts --network $(NETWORK)

#-------------- SETUP ----------------#

setup: deploy mint-platform-id mint-id create-course buy-course