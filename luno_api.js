const http = require('https');
const { Readable } = require('stream');
const { URLSearchParams } = require('url');

const BASE_URL = "api.luno.com"

const getRequest = (endpoint, isExchange, data, succ, err) => {
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
			succ(JSON.parse(data));
		});
	});
	req.on('error', err);
	req.end();
};

const authenticatedGetRequest = (endpoint, isExchange, auth, data, succ, err) => {
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
			succ(JSON.parse(data));
		});
	});
	req.on('error', err);
	req.end();
};

const postRequest = (endpoint, auth, data, succ, err) => {
	const authString = Buffer.from(auth.username + ":" + auth.password).toString('base64');
	const parameters = new URLSearchParams(data);
	const options = {
		hostname: BASE_URL,
		port: 443,
		path: "/api/1/" + endpoint + "?" + parameters.toString(),
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
			succ(JSON.parse(data));
		});
	});
	req.on('error', err);
	req.end();
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

	getPendingOrders(pair) {
		return new Promise((resolve, reject) => {
			authenticatedGetRequest('listorders', false, this.auth, { state: "PENDING", pair, limit: 1000 }, (response) => {
				if (response.error_code)
					reject(response);
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
					resolve(pendingOrders);
				}
			}, reject);
		});
	}

	cancelPendingOrder(orderID) {
		return new Promise((resolve, reject) => {
			postRequest('stoporder', this.auth, { order_id: orderID }, (response) => {
				if (response.error_code)
					reject(response);
				else
					resolve(response);
			}, reject);
		});
	}

	getBalances() {
		return new Promise((resolve, reject) => {
			authenticatedGetRequest('balance', false, this.auth, {}, (response) => {
				if (response.error_code)
					reject(response);
				else {
					const balances = response.balance;
					const wallet = {};
					for (const walletBalance of balances) {
						const balance = parseFloat(walletBalance.balance);
						const reserved = parseFloat(walletBalance.reserved);
						const available = balance - reserved;
						wallet[walletBalance.asset] = { balance, reserved, available };
					}
					resolve(wallet);
				}
			}, reject);
		});
	}

	postLimitOrder(action, amount, price, assetpair, priceDecimals, volumeDecimals) {
		const data = {
			pair: assetpair,
			type: action,
			volume: numberToString(amount, volumeDecimals),
			price: numberToString(price, priceDecimals)
		};
		return new Promise((resolve, reject) => {
			postRequest('postorder', this.auth, data, (response) => {
				if (response.error_code)
					reject(response);
				else
					resolve(response);
			}, reject);
		});
	}

	getAllTickers() {
		return new Promise((resolve, reject) => {
			getRequest('tickers', false, {}, (response) => {
				if (response.error_code)
					reject(response);
				else
					resolve(response);
			}, reject);
		});
	}

	getTicker(pair) {
		return new Promise((resolve, reject) => {
			getRequest('ticker', false, { pair }, (response) => {
				if (response.error_code)
					reject(response);
				else
					resolve(response);
			}, reject);
		});
	}

	getCandles(pair, startDate, endDate, duration) {

		const candleRequest = (pair, since, duration) => {
			return new Promise((resolve, reject) => {
				authenticatedGetRequest("candles", true, this.auth, { pair, since, duration }, (response) => {
					if (response.error_code)
						reject(response);
					else
						resolve(response.candles);
				}, reject);
			});
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
};

module.exports = { LunoClient }
