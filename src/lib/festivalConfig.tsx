export const getFestivalConfig = (festivalType: string) => {
  switch (festivalType) {
    case "diwali":
      return {
        cardBgClass: "bg-gradient-to-r from-[#0d0717] to-[#1a0e29]",
        cardDecorations: (
          <>
            <img src="https://cdn.pixabay.com/photo/2021/11/14/18/36/garland-6795493_1280.png" className="absolute top-0 left-0 w-full h-12 object-cover opacity-80" alt="" />
            <div className="absolute top-1/2 -translate-y-1/2 right-12 flex flex-col items-center z-10">
               <span className="text-white text-lg tracking-wide">Happy</span>
               <h3 className="text-5xl text-[#facc15] mt-1" style={{ fontFamily: "'Dancing Script', cursive" }}>Diwali</h3>
            </div>
            <img src="https://cdn-icons-png.flaticon.com/512/3050/3050041.png" className="absolute bottom-2 right-4 w-12 h-12 opacity-90 drop-shadow-[0_0_10px_#f59e0b]" alt="" />
            <img src="https://cdn-icons-png.flaticon.com/512/3050/3050041.png" className="absolute bottom-2 right-20 w-8 h-8 opacity-80 drop-shadow-[0_0_10px_#f59e0b]" alt="" />
            <img src="https://cdn-icons-png.flaticon.com/512/3050/3050041.png" className="absolute bottom-1 left-28 w-10 h-10 opacity-70" alt="" />
            <img src="https://cdn-icons-png.flaticon.com/512/3753/3753012.png" className="absolute top-6 right-8 w-8 h-8 opacity-50" alt="" />
          </>
        ),
        totalChargeImg: "https://cdn-icons-png.flaticon.com/512/3050/3050041.png",
        btnImgLeft: "https://cdn-icons-png.flaticon.com/512/3050/3050041.png",
        btnImgRight: "https://cdn-icons-png.flaticon.com/512/3050/3050041.png",
      };
    case "eid":
      return {
        cardBgClass: "bg-gradient-to-r from-[#040c17] to-[#0a192f]",
        cardDecorations: (
          <>
            <img src="https://cdn.pixabay.com/photo/2021/11/14/18/36/garland-6795493_1280.png" className="absolute top-0 left-0 w-full h-10 object-cover opacity-60" alt="" />
            <div className="absolute top-1/2 -translate-y-1/2 right-12 flex flex-col items-center z-10">
               <h3 className="text-4xl text-[#facc15] font-serif" style={{ fontFamily: "Georgia, serif" }}>Eid</h3>
               <h3 className="text-3xl text-white font-serif mt-1" style={{ fontFamily: "Georgia, serif" }}>Mubarak</h3>
            </div>
            <img src="https://cdn-icons-png.flaticon.com/512/1650/1650571.png" className="absolute top-0 right-12 w-10 h-16 opacity-90 drop-shadow-lg" alt="" />
            <img src="https://cdn-icons-png.flaticon.com/512/1650/1650571.png" className="absolute top-0 right-4 w-6 h-10 opacity-70" alt="" />
            <img src="https://cdn-icons-png.flaticon.com/512/2060/2060144.png" className="absolute bottom-0 right-0 w-36 opacity-70" alt="" />
          </>
        ),
        totalChargeImg: "https://cdn-icons-png.flaticon.com/512/1650/1650571.png",
        btnImgLeft: "https://cdn-icons-png.flaticon.com/512/1650/1650571.png",
        btnImgRight: "https://cdn-icons-png.flaticon.com/512/1650/1650571.png",
      };
    case "bakraeid":
      return {
        cardBgClass: "bg-gradient-to-r from-[#011406] to-[#0a2e1f]",
        cardDecorations: (
          <>
            <img src="https://cdn.pixabay.com/photo/2021/11/14/18/36/garland-6795493_1280.png" className="absolute top-0 left-0 w-full h-10 object-cover opacity-60 hue-rotate-60" alt="" />
            <div className="absolute top-1/2 -translate-y-1/2 right-[25%] flex flex-col items-center z-10">
               <span className="text-white text-lg">Happy</span>
               <h3 className="text-4xl text-[#86efac] mt-1" style={{ fontFamily: "'Dancing Script', cursive" }}>Bakra Eid</h3>
            </div>
            <img src="https://cdn-icons-png.flaticon.com/512/2874/2874052.png" className="absolute top-2 right-[40%] w-12 h-12 opacity-80" alt="" />
            {/* Goat image representing Bakra Eid */}
            <img src="https://cdn-icons-png.flaticon.com/512/4862/4862031.png" className="absolute bottom-0 right-4 w-28 object-contain z-10" alt="" />
            <img src="https://cdn-icons-png.flaticon.com/512/2060/2060144.png" className="absolute bottom-0 right-0 w-40 opacity-40 hue-rotate-60" alt="" />
          </>
        ),
        totalChargeImg: "https://cdn-icons-png.flaticon.com/512/2060/2060144.png",
        btnImgLeft: "https://cdn-icons-png.flaticon.com/512/2060/2060144.png",
        btnImgRight: "https://cdn-icons-png.flaticon.com/512/2060/2060144.png",
      };
    case "christmas":
      return {
        cardBgClass: "bg-gradient-to-r from-[#051c0d] to-[#0a2614]",
        cardDecorations: (
          <>
            <img src="https://cdn.pixabay.com/photo/2021/11/14/18/36/garland-6795493_1280.png" className="absolute top-0 left-0 w-full h-12 object-cover opacity-90" alt="" />
            <div className="absolute top-1/2 -translate-y-1/2 right-[20%] flex flex-col items-center z-10">
               <span className="text-white text-lg">Merry</span>
               <h3 className="text-5xl text-[#ef4444] mt-1" style={{ fontFamily: "'Dancing Script', cursive", textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>Christmas</h3>
            </div>
            <img src="https://cdn-icons-png.flaticon.com/512/3799/3799981.png" className="absolute bottom-0 right-0 w-32 drop-shadow-lg z-10" alt="" />
            <img src="https://cdn-icons-png.flaticon.com/512/4213/4213958.png" className="absolute bottom-2 right-[28%] w-12 drop-shadow-md z-0" alt="" />
            <img src="https://cdn-icons-png.flaticon.com/512/3799/3799960.png" className="absolute -bottom-2 -left-2 w-28 opacity-95 transform -scale-x-100 z-10 drop-shadow-md" alt="" />
            <div className="absolute top-6 right-1/2 w-1.5 h-1.5 bg-white rounded-full opacity-80 shadow-[0_0_5px_white]"></div>
            <div className="absolute top-10 right-[15%] w-2 h-2 bg-white rounded-full opacity-60 shadow-[0_0_5px_white]"></div>
          </>
        ),
        totalChargeImg: "https://cdn-icons-png.flaticon.com/512/3799/3799981.png",
        btnImgLeft: "https://cdn-icons-png.flaticon.com/512/3799/3799960.png",
        btnImgRight: "https://cdn-icons-png.flaticon.com/512/4213/4213958.png",
      };
    case "holi":
      return {
        cardBgClass: "bg-gradient-to-r from-[#090b14] to-[#0f172a]",
        cardDecorations: (
          <>
            <img src="https://cdn.pixabay.com/photo/2021/11/14/18/36/garland-6795493_1280.png" className="absolute top-0 left-0 w-full h-12 object-cover opacity-90" alt="" />
            <div className="absolute top-1/2 -translate-y-1/2 right-[20%] flex flex-col items-center z-10 mt-2">
               <span className="text-white text-lg">Happy</span>
               <h3 className="text-6xl mt-0 font-bold text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-yellow-400 to-cyan-500" style={{ fontFamily: "'Dancing Script', cursive", paddingBottom: '5px' }}>Holi</h3>
            </div>
            <img src="https://cdn-icons-png.flaticon.com/512/4236/4236688.png" className="absolute bottom-0 right-2 w-24 opacity-90 drop-shadow-lg" alt="" />
            <img src="https://cdn-icons-png.flaticon.com/512/1151/1151121.png" className="absolute -top-6 -right-6 w-32 opacity-60 rotate-12" alt="" />
            <img src="https://cdn-icons-png.flaticon.com/512/1151/1151121.png" className="absolute bottom-0 left-[45%] w-20 opacity-40 hue-rotate-90" alt="" />
            {/* Handprints */}
            <img src="https://cdn-icons-png.flaticon.com/512/2816/2816917.png" className="absolute top-4 right-[45%] w-8 h-8 opacity-80" alt="" />
            <img src="https://cdn-icons-png.flaticon.com/512/2816/2816917.png" className="absolute top-12 right-[10%] w-10 h-10 opacity-80 hue-rotate-[220deg]" alt="" />
          </>
        ),
        totalChargeImg: "https://cdn-icons-png.flaticon.com/512/4236/4236688.png",
        btnImgLeft: "https://cdn-icons-png.flaticon.com/512/1151/1151121.png",
        btnImgRight: "https://cdn-icons-png.flaticon.com/512/1151/1151121.png",
      };
    case "rakshabandhan":
      return {
        cardBgClass: "bg-gradient-to-r from-[#1c0209] to-[#2d0814]",
        cardDecorations: (
          <>
            <img src="https://cdn.pixabay.com/photo/2021/11/14/18/36/garland-6795493_1280.png" className="absolute top-0 left-0 w-full h-12 object-cover opacity-90" alt="" />
            <div className="absolute top-1/2 -translate-y-1/2 right-[10%] flex flex-col items-center z-10 w-[180px] text-center">
               <span className="text-white text-lg whitespace-nowrap">Happy</span>
               <h3 className="text-[2.5rem] leading-none text-[#facc15] mt-1" style={{ fontFamily: "'Dancing Script', cursive", textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>Raksha Bandhan</h3>
            </div>
            {/* Rakhi on the right */}
            <img src="https://cdn-icons-png.flaticon.com/512/10703/10703080.png" className="absolute -bottom-6 -right-6 w-36 object-contain rotate-12 drop-shadow-xl" alt="" />
            {/* Gift on the bottom left (behind the text, but visible on the left side) */}
            <img src="https://cdn-icons-png.flaticon.com/512/4213/4213958.png" className="absolute -bottom-2 left-6 w-24 object-contain opacity-90" alt="" />
            {/* Small hearts */}
            <svg className="absolute top-[40%] right-[55%] w-4 h-4 text-[#facc15] opacity-80" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            <svg className="absolute top-[30%] right-[10%] w-3 h-3 text-[#facc15] opacity-80" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </>
        ),
        totalChargeImg: "https://cdn-icons-png.flaticon.com/512/10703/10703080.png",
        btnImgLeft: "https://cdn-icons-png.flaticon.com/512/10703/10703080.png",
        btnImgRight: "https://cdn-icons-png.flaticon.com/512/10703/10703080.png",
      };
    default:
      return null;
  }
};
