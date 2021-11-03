const Store = require('electron-store');
const { ipcRenderer } = require('electron')
const React = require('react');
const ReactDOM = require('react-dom');

const store = new Store();

// To avoid using webpack, we'll just use react without JSX
const h = React.createElement;

function WallPaperList( props ) {

	let available_wallpapers = store.get( 'available-wallpapers.list', [] );
	let current = store.get( 'current.key', '' );

	const render_months = () => {
		let list = [];

		// Loop over all months
		for( month in available_wallpapers ) {
			list.push( h( WallPaperItem, {
				key: month,
				month: month,
				path: props.path,
				wallpapers: available_wallpapers[ month ],
				is_current: current == month
			} ) );
		}

		// Show the list in reverse
		return list.reverse();
	}

	return h('div', { className:"wallpapers" }, [
		h( 'ul', { key: 'list' }, render_months() )
	]);
}

function WallPaperItem( props ){
	return h( 'li', { key: props.month + '-item', className: props.is_current ? 'current' : '' }, [
		h( 'img', {
			key: props.month + '-image',
			// The images are huge, maybe we need to generate thumbnails
			src: 'file://' + props.path + '/files/' + props.wallpapers.landscape,
			onClick: () => {
				ipcRenderer.send('set-wallpaper', props.month);
			}
		} )
	] );
}

window.addEventListener('DOMContentLoaded', () => {
	ipcRenderer.invoke('read-user-data-path').then( (result) => {
		ReactDOM.render(h(WallPaperList, { path: result }), document.getElementById('wallpapers'));
	});

})