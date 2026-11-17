const http = require('https');
const { Readable } = require('stream');
const { URLSearchParams } = require('url');

const BASE_URL = "api.luno.com"

const getRequest = (endpoint, isExchange, data) => {
	return new Promise((resolve, reject) => {
		const parameters = new URLSearchParams(data);
		const options = {
			hostname: BASE_URL,
			port: 443,
			path: "/api" + (isExchange ? "/exchange/" : "/") + "1/" + endpoint + "?" + parameters.toString(),
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		}

		const req = http.request(options, (res) => {
			var data = "";
			res.on('data', (d) => {
				data += d;
			});

			res.on('end', () => {
				resolve(JSON.parse(data));
			});
		});
		req.on('error', reject);
		req.end();
	});
};

const authenticatedGetRequest = (endpoint, isExchange, auth, data) => {
	return new Promise((resolve, reject) => {
		const authString = Buffer.from(auth.username + ":" + auth.password).toString('base64');
		const parameters = new URLSearchParams(data);
		const options = {
			hostname: BASE_URL,
			port: 443,
			path: "/api" + (isExchange ? "/exchange/" : "/") + "1/" + endpoint + "?" + parameters.toString(),
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': 'Basic ' + authString
			}
		}

		const req = http.request(options, (res) => {
			var data = "";
			res.on('data', (d) => {
				data += d;
			});

			res.on('end', () => {
				resolve(JSON.parse(data));
			});
		});
		req.on('error', reject);
		req.end();
	});
};

const postRequest = (endpoint, isExchange, auth, data) => {
	return new Promise((resolve, reject) => {
		const authString = Buffer.from(auth.username + ":" + auth.password).toString('base64');
		const parameters = new URLSearchParams(data);
		const options = {
			hostname: BASE_URL,
			port: 443,
			path: "/api"+ (isExchange ? "/exchange/" : "/") + "1/" + endpoint + "?" + parameters.toString(),
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Authorization': 'Basic ' + authString
			}
		}

		const req = http.request(options, (res) => {
			var data = "";
			res.on('data', (d) => {
				data += d;
			});

			res.on('end', () => {
				resolve(JSON.parse(data));
			});
		});
		req.on('error', reject);
		req.end();
	});
};

const numberToString = (num, decimals) => {
	const scaler = 10 ** decimals;
	const floored = Math.floor(num * scaler) / scaler;
	return floored.toFixed(decimals);
};

class LunoClient {
	constructor(key, secret) {
		this.auth = { username: key, password: secret };
	}

	AccountTypes = {
		TRANSACTIONAL: "TRANSACTIONAL",
		TRADING: "SPOT",
	};

	Actions = {
		BUY: "BID",
		SELL: "ASK",
	};

	async getPendingOrders(pair) {
		const response = await authenticatedGetRequest('listorders', false, this.auth, { state: "PENDING", pair, limit: 1000 });
		if (response.error_code)
			throw response;
		else {
			const pendingOrders = [];
			if (response.orders) {
				for (const order of response.orders) {
					pendingOrders.push({
						id: order.order_id,
						type: order.type,
						price: parseFloat(order.limit_price),
						amount: parseFloat(order.limit_volume),
						filled: parseFloat(order.base),
						created: parseInt(order.creation_timestamp)
					});
				}
			}
			return pendingOrders;
		}
	}

	async cancelPendingOrder(orderID) {
		const response = await postRequest('stoporder', false, this.auth, { order_id: orderID });
		if (response.error_code)
			throw response;
		else
			return response;
	}

	async getWallets() {
		const response = await authenticatedGetRequest('balance', false, this.auth, {});
		if (response.error_code)
			throw response;
		else {
			const balances = response.balance;
			const wallets = [];

			for (const walletBalance of balances) {
				const id = walletBalance.account_id;
				const asset = walletBalance.asset;
				const type = walletBalance.account_type;
				const balance = parseFloat(walletBalance.balance);
				const reserved = parseFloat(walletBalance.reserved);
				const available = balance - reserved;
				wallets.push({ id, asset, type, balance, reserved, available});
			}
			return wallets;
		}
	}

	findWallet(wallets, asset, type) {
		let filtered = wallets;
		if (asset)
			filtered = filtered.filter(account => account.asset === asset);

		if (type)
			filtered = filtered.filter(account => account.type === type);

		return filtered.length === 1 ? filtered[0] : filtered;
	}

	async postLimitOrder(action, amount, price, assetpair, priceDecimals, volumeDecimals) {
		const data = {
			pair: assetpair,
			type: action,
			volume: numberToString(amount, volumeDecimals),
			price: numberToString(price, priceDecimals)
		};
		const response = await postRequest('postorder', false, this.auth, data);
		if (response.error_code)
			throw response;
		else
			return response;
	}

	async getAllTickers() {
		const response = await getRequest('tickers', false, {});
		if (response.error_code)
			throw response;
		else
			return response;
	}

	async getTicker(pair) {
		const response = await getRequest('ticker', false, { pair });
		if (response.error_code)
			throw response;
		else
			return response;

	}

	getCandles(pair, startDate, endDate, duration) {
		const candleRequest = async (pair, since, duration) => {
			const response = await authenticatedGetRequest("candles", true, this.auth, { pair, since, duration });
			if (response.error_code)
				throw response;
			else
				return response.candles;
		};

		class CandleStream extends Readable {
			constructor(pair, startDate, endDate, duration, options = { objectMode: true }) {
				super(options);
				this.pair = pair;
				this.since = startDate.getTime();
				this.until = endDate.getTime();
				this.duration = duration;
				this.isFetching = false;
				this.finished = false;
				this.rateLimit = (60 * 1000) / (0.95 * 300); // 300 requests per minute wait time (only use 95% thereof)
			}

			_read() {
				if (this.isFetching || this.finished) return;

				this.isFetching = true;

				const processData = (candles) => {
					candles.forEach(candle => {
						if (candle.timestamp < this.until)
							this.push(candle);
					});

					const lastEntryTime = candles.at(-1).timestamp;
					if (candles.length == 1000 && lastEntryTime < this.until) {
						setTimeout(() => {
							candleRequest(this.pair, lastEntryTime + this.duration * 1000, this.duration).then(processData).catch(this.destroy);
						}, this.rateLimit);
					}
					else {
						this.push(null);
						this.finished = true;
					}
				};

				candleRequest(this.pair, this.since, this.duration).then(processData).catch(this.destroy);
			}
		};

		return new CandleStream(pair, startDate, endDate, duration);
	}

	async getOrderBook(pair) {
		const response = await getRequest("orderbook_top", false, { pair });
		if (response.error_code)
			throw response;
		else
			return response;
	}

	async getMoveStatus(id) {
		const response = await authenticatedGetRequest('move', true, this.auth, {id});
		if (response.error_code)
			throw response;
		else
			return response;
	}

	async moveFunds(amount, from_account, to_account) {
		const data = {
			amount,
			debit_account_id: from_account,
			credit_account_id: to_account
		};
		const response = await postRequest('move', true, this.auth, data);
		if (response.error_code)
			throw response;
		else
			return response;
	}
};

module.exports = { LunoClient }
